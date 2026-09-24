import { prisma } from "@/lib/prisma";
import { securityEvent } from "@/lib/security-events";
import { currentRequestId } from "@/lib/request-context";

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
  const { count } = await prisma.apiKey.updateMany({
    where: { createdById: userId, orgId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  // Only report what actually happened: emitting unconditionally would make an offboarding
  // of 40 members read as 40 destroyed credentials when the real number may be zero.
  // `userId` here is the account acted UPON, not an actor — the acting admin is carried by
  // the admin.action event from the same request, tied to this one by requestId.
  if (count > 0) {
    securityEvent("apikey.revoked", {
      requestId: await currentRequestId(),
      targetUserId: userId,
      orgId,
      meta: { count, reason: "credential_revocation" },
    });
  }
}
