import { prisma } from "@/lib/prisma";
import { generateAccessToken, hashOAuthSecret } from "@/lib/oauth/tokens";
import { ALL_OAUTH_SCOPES } from "@/lib/oauth/scopes";

const INTERNAL_CLIENT_NAME = "JedForge AI Chat (internal)";

async function getOrCreateInternalClient(): Promise<string> {
  const existing = await prisma.oAuthClient.findFirst({
    where: { clientName: INTERNAL_CLIENT_NAME },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.oAuthClient.create({
    data: {
      clientName: INTERNAL_CLIENT_NAME,
      redirectUris: [],
      tokenEndpointAuthMethod: "none",
      grantTypes: [],
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Mints a short-lived (10 min) access token scoped to the given user/org, for
 * the chat route to hand to the MCP connector as authorization_token. Reuses
 * the existing OAuth access-token machinery so any tool added to
 * src/lib/mcp/server.ts is automatically available here too.
 */
export async function mintInternalMcpToken(userId: string, orgId: string): Promise<string> {
  const clientId = await getOrCreateInternalClient();
  const plaintext = generateAccessToken();

  await prisma.oAuthAccessToken.create({
    data: {
      hashedToken: hashOAuthSecret(plaintext),
      clientId,
      userId,
      orgId,
      scope: ALL_OAUTH_SCOPES.join(" "),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return plaintext;
}
