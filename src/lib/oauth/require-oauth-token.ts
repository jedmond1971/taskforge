import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashOAuthSecret } from "@/lib/oauth/tokens";
import { getOAuthBaseUrl } from "@/lib/oauth/config";

// Scaffold for the Phase B2 MCP server (JFR-100) — validates the bearer access
// token issued by /api/oauth/token and resolves it to an org/user/scope context.
export type OAuthTokenContext = {
  orgId: string;
  userId: string;
  clientId: string;
  scope: string;
};

function unauthorized(): NextResponse {
  const resourceMetadataUrl = `${getOAuthBaseUrl()}/.well-known/oauth-protected-resource`;
  return NextResponse.json(
    { error: "invalid_token" },
    {
      status: 401,
      headers: { "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"` },
    }
  );
}

export async function requireOAuthToken(request: Request): Promise<OAuthTokenContext | NextResponse> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return unauthorized();

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return unauthorized();

  const hashed = hashOAuthSecret(token);
  const accessToken = await prisma.oAuthAccessToken.findUnique({
    where: { hashedToken: hashed },
    select: { orgId: true, userId: true, clientId: true, scope: true, revokedAt: true, expiresAt: true },
  });

  if (!accessToken || accessToken.revokedAt !== null || accessToken.expiresAt < new Date()) {
    return unauthorized();
  }

  return {
    orgId: accessToken.orgId,
    userId: accessToken.userId,
    clientId: accessToken.clientId,
    scope: accessToken.scope,
  };
}
