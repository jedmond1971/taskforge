import { randomUUID, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  generateAccessToken,
  generateRefreshToken,
  hashOAuthSecret,
  verifyPkceS256,
} from "@/lib/oauth/tokens";
import { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS } from "@/lib/oauth/config";
import { checkRateLimit, recordFailure, getClientIp, LIMITS } from "@/lib/rate-limit";

function tokenError(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status });
}

async function authenticateClient(
  request: Request,
  body: Record<string, string>,
  client: { clientSecretHash: string | null; tokenEndpointAuthMethod: string }
): Promise<boolean> {
  if (client.tokenEndpointAuthMethod === "none") return true;

  let secret: string | null = null;
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice("Basic ".length), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex !== -1) secret = decoded.slice(separatorIndex + 1);
  }
  if (!secret) secret = body.client_secret ?? null;

  if (!secret || !client.clientSecretHash) return false;
  // Constant-time: a byte-wise `===` on the digests would leak how much of a guess matched.
  const presented = Buffer.from(hashOAuthSecret(secret));
  const stored = Buffer.from(client.clientSecretHash);
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

// SECH-109: every token minted from one authorization grant shares a familyId, so a
// replayed (already-rotated) refresh token can take its whole lineage down with it.
async function revokeTokenFamily(familyId: string) {
  const now = new Date();
  const members = await prisma.oAuthRefreshToken.findMany({
    where: { familyId },
    select: { id: true, accessTokenId: true },
  });
  const accessTokenIds = members.map((m) => m.accessTokenId).filter((id): id is string => id !== null);
  await prisma.$transaction([
    prisma.oAuthRefreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.oAuthAccessToken.updateMany({
      where: { id: { in: accessTokenIds }, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
}

async function issueTokenPair(params: {
  clientId: string;
  userId: string;
  orgId: string;
  scope: string;
  familyId?: string;
}) {
  const plaintextAccessToken = generateAccessToken();
  const plaintextRefreshToken = generateRefreshToken();
  const now = Date.now();

  const accessToken = await prisma.oAuthAccessToken.create({
    data: {
      hashedToken: hashOAuthSecret(plaintextAccessToken),
      clientId: params.clientId,
      userId: params.userId,
      orgId: params.orgId,
      scope: params.scope,
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
    },
  });

  await prisma.oAuthRefreshToken.create({
    data: {
      hashedToken: hashOAuthSecret(plaintextRefreshToken),
      clientId: params.clientId,
      accessTokenId: accessToken.id,
      familyId: params.familyId ?? randomUUID(),
      userId: params.userId,
      orgId: params.orgId,
      scope: params.scope,
      expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    },
  });

  return NextResponse.json({
    access_token: plaintextAccessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: plaintextRefreshToken,
    scope: params.scope,
  });
}

export async function POST(request: Request) {
  let body: Record<string, string>;
  try {
    const formData = await request.formData();
    body = Object.fromEntries(formData.entries()) as Record<string, string>;
  } catch {
    return tokenError("invalid_request", "Request body must be application/x-www-form-urlencoded");
  }

  // SECH-107: failure-counted, per IP+client_id and per IP alone (so rotating
  // client_id doesn't reset the budget). Legitimate token flows almost never fail.
  const ip = getClientIp(request);
  const buckets = [
    { key: `oauth-token:${ip}:${body.client_id || "-"}`, config: LIMITS.oauthTokenFailuresPerClientIp },
    { key: `oauth-token-ip:${ip}`, config: LIMITS.oauthTokenFailuresPerIp },
  ];
  const checks = await Promise.all(buckets.map((b) => checkRateLimit(b.key, b.config)));
  const blocked = checks.find((c) => !c.allowed);
  if (blocked) {
    return NextResponse.json(
      { error: "temporarily_unavailable", error_description: "Too many failed token requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(blocked.retryAfterSeconds) } }
    );
  }

  const response = await handleGrant(request, body);
  if (response.status >= 400) {
    await Promise.all(buckets.map((b) => recordFailure(b.key, b.config.windowMs)));
  }
  return response;
}

async function handleGrant(request: Request, body: Record<string, string>): Promise<Response> {
  const grantType = body.grant_type;
  const clientId = body.client_id;
  if (!clientId) return tokenError("invalid_client", "client_id is required");

  const client = await prisma.oAuthClient.findUnique({ where: { id: clientId } });
  if (!client) return tokenError("invalid_client", "Unknown client_id", 401);

  if (!(await authenticateClient(request, body, client))) {
    return tokenError("invalid_client", "Client authentication failed", 401);
  }

  if (grantType === "authorization_code") {
    const { code, redirect_uri: redirectUri, code_verifier: codeVerifier } = body;
    if (!code || !redirectUri || !codeVerifier) {
      return tokenError("invalid_request", "code, redirect_uri, and code_verifier are required");
    }

    const authCode = await prisma.oAuthAuthorizationCode.findUnique({
      where: { hashedCode: hashOAuthSecret(code) },
    });

    if (
      !authCode ||
      authCode.clientId !== client.id ||
      authCode.usedAt !== null ||
      authCode.expiresAt < new Date() ||
      authCode.redirectUri !== redirectUri
    ) {
      return tokenError("invalid_grant", "Authorization code is invalid, expired, or already used");
    }

    if (!verifyPkceS256(codeVerifier, authCode.codeChallenge)) {
      return tokenError("invalid_grant", "code_verifier does not match code_challenge");
    }

    // Conditional update guards against a concurrent replay of the same code.
    const claimed = await prisma.oAuthAuthorizationCode.updateMany({
      where: { id: authCode.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      return tokenError("invalid_grant", "Authorization code is invalid, expired, or already used");
    }

    return issueTokenPair({
      clientId: client.id,
      userId: authCode.userId,
      orgId: authCode.orgId,
      scope: authCode.scope,
    });
  }

  if (grantType === "refresh_token") {
    const plaintextRefreshToken = body.refresh_token;
    if (!plaintextRefreshToken) return tokenError("invalid_request", "refresh_token is required");

    const refreshToken = await prisma.oAuthRefreshToken.findUnique({
      where: { hashedToken: hashOAuthSecret(plaintextRefreshToken) },
    });

    if (
      !refreshToken ||
      refreshToken.clientId !== client.id ||
      refreshToken.expiresAt < new Date()
    ) {
      return tokenError("invalid_grant", "Refresh token is invalid, expired, or revoked");
    }

    // SECH-109 reuse detection: the token was already rotated (or revoked) and has come
    // back. Treat it as a copied credential and kill the whole family, so the descendants
    // the thief (or the victim) is holding stop working too. This is deliberately NOT the
    // same path as losing the concurrent-claim race below — that is one honest client
    // racing itself, and it reads revokedAt: null here.
    if (refreshToken.revokedAt !== null) {
      await revokeTokenFamily(refreshToken.familyId);
      return tokenError("invalid_grant", "Refresh token is invalid, expired, or revoked");
    }

    // Rotation: this refresh token (and the access token it was paired with)
    // is single-use — revoke both before issuing the replacement pair. The
    // conditional claim (revokedAt: null) makes concurrent replays of one
    // refresh token lose the race instead of each minting a new pair (SECH-97).
    const claimed = await prisma.$transaction(async (tx) => {
      const { count } = await tx.oAuthRefreshToken.updateMany({
        where: { id: refreshToken.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) return false;
      if (refreshToken.accessTokenId) {
        await tx.oAuthAccessToken.update({
          where: { id: refreshToken.accessTokenId },
          data: { revokedAt: new Date() },
        });
      }
      return true;
    });
    if (!claimed) {
      return tokenError("invalid_grant", "Refresh token is invalid, expired, or revoked");
    }

    return issueTokenPair({
      clientId: client.id,
      userId: refreshToken.userId,
      orgId: refreshToken.orgId,
      scope: refreshToken.scope,
      familyId: refreshToken.familyId,
    });
  }

  return tokenError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
}
