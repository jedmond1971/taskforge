import { prisma } from "@/lib/prisma";

/**
 * Revokes every OAuth access/refresh token for a user (optionally scoped to one
 * org). Call this at the same events that already bump User.sessionVersion
 * (password change, admin password reset, platform role change) and on org
 * removal (SECH-94) — OAuth tokens are opaque bearer strings with no captured
 * session version to compare against, so revocation has to be push-based at
 * the triggering event rather than checked live per request the way the JWT
 * session callback checks sessionVersion.
 */
export async function revokeOAuthTokensForUser(userId: string, orgId?: string): Promise<void> {
  const where = orgId ? { userId, orgId, revokedAt: null } : { userId, revokedAt: null };
  await prisma.$transaction(async (tx) => {
    await tx.oAuthAccessToken.updateMany({ where, data: { revokedAt: new Date() } });
    await tx.oAuthRefreshToken.updateMany({ where, data: { revokedAt: new Date() } });
  });
}

/** Revokes every org API key a user created within one org, e.g. when they leave it (SECH-94). */
export async function revokeApiKeysForUser(userId: string, orgId: string): Promise<void> {
  await prisma.apiKey.updateMany({
    where: { createdById: userId, orgId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
