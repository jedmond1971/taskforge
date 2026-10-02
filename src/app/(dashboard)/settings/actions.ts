"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { revokeOAuthTokensForUser } from "@/lib/credential-revocation";
import { checkRateLimit, recordFailure, tooManyAttemptsMessage, LIMITS } from "@/lib/rate-limit";
import { securityEvent } from "@/lib/security-events";

type ActionResult = { success: true } | { success: false; error: string };

const MAX_NAME_LENGTH = 100;

/**
 * Self-service display-name change. Only `name` is writable and only on the caller's own row —
 * the target id comes from the session, never from the client (no mass assignment).
 */
export async function updateOwnProfile(input: { name: string }): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "Unauthorized" };

  // Collapse whitespace and drop control characters so a name can't smuggle newlines into logs/emails.
  const name = String(input?.name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return { success: false, error: "Name is required" };
  if (name.length > MAX_NAME_LENGTH)
    return { success: false, error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` };

  await prisma.user.update({ where: { id: session.user.id }, data: { name } });
  return { success: true };
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "Unauthorized" };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });

  if (!user) return { success: false, error: "User not found" };

  // A hijacked session must not be able to brute-force the current password into
  // a full takeover: wrong-password failures are counted per user (SECH-107).
  const limitKey = `pw-change:${session.user.id}`;
  const limit = await checkRateLimit(limitKey, LIMITS.changePasswordFailuresPerUser);
  if (!limit.allowed) return { success: false, error: tooManyAttemptsMessage(limit.retryAfterSeconds) };

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isValid) {
    await recordFailure(limitKey, LIMITS.changePasswordFailuresPerUser.windowMs);
    return { success: false, error: "Current password is incorrect" };
  }

  if (newPassword.length < 8)
    return { success: false, error: "New password must be at least 8 characters" };

  if (newPassword === currentPassword)
    return { success: false, error: "New password must be different from your current password" };

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      passwordHash: await bcrypt.hash(newPassword, 12),
      sessionVersion: { increment: 1 },
    },
  });

  securityEvent("session.invalidated", {
    userId: session.user.id,
    targetUserId: session.user.id, // self-service: actor and subject are the same account
    meta: { trigger: "self_password_change" },
  });
  // OAuth tokens have no captured session version to check live (SECH-94) —
  // revoke them here, the same trigger that invalidates web sessions.
  await revokeOAuthTokensForUser(session.user.id);

  return { success: true };
}
