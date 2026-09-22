"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getInviteWithStatus } from "@/lib/invites";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { headers } from "next/headers";
import {
  checkRateLimit,
  clientIpFromHeaders,
  consumeRateLimit,
  recordFailure,
  tooManyAttemptsMessage,
  LIMITS,
} from "@/lib/rate-limit";

// Invite tokens are bearer secrets: never put the raw value in a limiter key.
const tokenKey = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 32);

export async function acceptInviteNewUser(
  token: string,
  name: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  // Unauthenticated (SECH-107): bad/expired/used tokens are failure-counted per IP,
  // and any single token gets a fixed number of attempts (which also caps bcrypt work).
  const ipKey = `invite-ip:${clientIpFromHeaders(await headers())}`;
  const ipLimit = await checkRateLimit(ipKey, LIMITS.inviteFailuresPerIp);
  if (!ipLimit.allowed) return { success: false, error: tooManyAttemptsMessage(ipLimit.retryAfterSeconds) };
  const tokenLimit = await consumeRateLimit(`invite-token:${tokenKey(token)}`, LIMITS.inviteAttemptsPerToken);
  if (!tokenLimit.allowed) return { success: false, error: tooManyAttemptsMessage(tokenLimit.retryAfterSeconds) };

  const invite = await getInviteWithStatus(token);
  if (invite.status !== "VALID") await recordFailure(ipKey, LIMITS.inviteFailuresPerIp.windowMs);
  if (invite.status === "NOT_FOUND") return { success: false, error: "This invite link is invalid." };
  if (invite.status === "EXPIRED") return { success: false, error: `This invite to join ${invite.orgName} has expired.` };
  if (invite.status === "ALREADY_ACCEPTED") return { success: false, error: "This invite has already been used." };

  const { orgId, email, role } = invite;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return {
      success: false,
      error: "An account already exists for this email. Log in first, then use the invite link.",
    };
  }

  if (!name.trim()) return { success: false, error: "Name is required." };
  if (password.length < 8) return { success: false, error: "Password must be at least 8 characters." };

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: name.trim(), email, passwordHash, role: "TEAM_MEMBER" },
    });
    await tx.orgMember.create({
      data: { orgId, userId: user.id, role },
    });
    await tx.orgInvite.update({
      where: { token },
      data: { accepted: true, acceptedAt: new Date() },
    });
  });

  revalidatePath("/admin/invites");
  return { success: true };
}

export async function acceptInviteExistingUser(
  token: string
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "You must be logged in to accept this invite." };

  const limit = await consumeRateLimit(`invite-user:${session.user.id}`, LIMITS.inviteExistingUserPerUser);
  if (!limit.allowed) return { success: false, error: tooManyAttemptsMessage(limit.retryAfterSeconds) };

  const invite = await getInviteWithStatus(token);
  if (invite.status === "NOT_FOUND") return { success: false, error: "This invite link is invalid." };
  if (invite.status === "EXPIRED") return { success: false, error: `This invite to join ${invite.orgName} has expired.` };
  if (invite.status === "ALREADY_ACCEPTED") return { success: false, error: "This invite has already been used." };

  const { orgId, email, role } = invite;

  if (session.user.email?.toLowerCase() !== email.toLowerCase()) {
    return { success: false, error: "This invite was sent to a different email address." };
  }

  const existingMember = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId: session.user.id } },
  });

  await prisma.$transaction(async (tx) => {
    if (!existingMember) {
      await tx.orgMember.create({
        data: { orgId, userId: session.user.id, role },
      });
    }
    await tx.orgInvite.update({
      where: { token },
      data: { accepted: true, acceptedAt: new Date() },
    });
  });

  revalidatePath("/admin/invites");
  return { success: true };
}
