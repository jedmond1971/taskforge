import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  generateAccessToken,
  generateRefreshToken,
  hashOAuthSecret,
  verifyPkceS256,
} from "@/lib/oauth/tokens";
import { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS } from "@/lib/oauth/config";

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
  return hashOAuthSecret(secret) === client.clientSecretHash;
}

async function issueTokenPair(params: {
  clientId: string;
  userId: string;
  orgId: string;
  scope: string;
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
      refreshToken.revokedAt !== null ||
      refreshToken.expiresAt < new Date()
    ) {
      return tokenError("invalid_grant", "Refresh token is invalid, expired, or revoked");
    }

    // Rotation: this refresh token (and the access token it was paired with)
    // is single-use — revoke both before issuing the replacement pair.
    await prisma.$transaction([
      prisma.oAuthRefreshToken.update({
        where: { id: refreshToken.id },
        data: { revokedAt: new Date() },
      }),
      ...(refreshToken.accessTokenId
        ? [
            prisma.oAuthAccessToken.update({
              where: { id: refreshToken.accessTokenId },
              data: { revokedAt: new Date() },
            }),
          ]
        : []),
    ]);

    return issueTokenPair({
      clientId: client.id,
      userId: refreshToken.userId,
      orgId: refreshToken.orgId,
      scope: refreshToken.scope,
    });
  }

  return tokenError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
}
