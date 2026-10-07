"use server";

import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  clientIpFromHeaders,
  consumeRateLimit,
  recordFailure,
  tooManyAttemptsMessage,
  LIMITS,
} from "@/lib/rate-limit";
import { revokeOAuthTokensForUser } from "@/lib/credential-revocation";
import { securityEvent } from "@/lib/security-events";
import { findValidResetToken, hashResetToken } from "@/lib/password-reset";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

type ResetResult = { success: true } | { success: false; error: string };

const INVALID_LINK = "This reset link is invalid or has expired. Request a new one.";

/**
 * Public (unauthenticated); the token is the credential. Bad/expired/used tokens are failure-counted
 * per IP and any one token gets a fixed number of tries (which also bounds bcrypt work), like the
 * invite flow (SECH-107). A successful reset consumes the token, bumps `sessionVersion` (every web
 * session is invalidated, SECH-86), revokes OAuth tokens (SECH-94) and does NOT sign anyone in.
 */
export async function resetPassword(token: string, newPassword: string): Promise<ResetResult> {
  const ipKey = `pw-reset-ip:${clientIpFromHeaders(await headers())}`;
  const ipLimit = await checkRateLimit(ipKey, LIMITS.passwordResetFailuresPerIp);
  if (!ipLimit.allowed) return { success: false, error: tooManyAttemptsMessage(ipLimit.retryAfterSeconds) };
  const tokenDigest = createHash("sha256").update(String(token)).digest("hex").slice(0, 32);
  const tokenLimit = await consumeRateLimit(`pw-reset-token:${tokenDigest}`, LIMITS.passwordResetAttemptsPerToken);
  if (!tokenLimit.allowed) return { success: false, error: tooManyAttemptsMessage(tokenLimit.retryAfterSeconds) };

  const found = await findValidResetToken(String(token));
  if (!found) {
    await recordFailure(ipKey, LIMITS.passwordResetFailuresPerIp.windowMs);
    return { success: false, error: INVALID_LINK };
  }

  // Checked after the token so a typo'd password doesn't burn the link; the token is only consumed below.
  if (typeof newPassword !== "string" || newPassword.length < PASSWORD_MIN_LENGTH) {
    return { success: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (newPassword.length > PASSWORD_MAX_LENGTH) {
    return { success: false, error: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` };
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  const userId = await prisma.$transaction(async (tx) => {
    // Deleting is the atomic claim: of two concurrent submissions only one sees count === 1.
    const claimed = await tx.passwordResetToken.deleteMany({
      where: { tokenHash: hashResetToken(String(token)), expiresAt: { gt: new Date() } },
    });
    if (claimed.count !== 1) return null;
    await tx.user.update({
      where: { id: found.userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    // Any other emailed link for this account is now stale.
    await tx.passwordResetToken.deleteMany({ where: { userId: found.userId } });
    return found.userId;
  });

  if (!userId) {
    await recordFailure(ipKey, LIMITS.passwordResetFailuresPerIp.windowMs);
    return { success: false, error: INVALID_LINK };
  }

  securityEvent("session.invalidated", {
    userId,
    targetUserId: userId, // the link holder acts on their own account
    meta: { trigger: "password_reset" },
  });
  await revokeOAuthTokensForUser(userId);

  return { success: true };
}
