import { createHash, randomBytes } from "crypto";
import { Resend } from "resend";
import { render } from "@react-email/components";
import { PasswordResetEmail } from "@/emails/PasswordResetEmail";
import { prisma } from "@/lib/prisma";
import { logError, securityEvent } from "@/lib/security-events";

export const PASSWORD_RESET_EXPIRY_MINUTES = 60;
const RESET_FROM = "JedForge <security@jedforge.com>";

/** Same normalisation as the login form (auth.ts), so a reset finds the account login would. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Only this digest is stored or used in a limiter key; the raw token is a bearer secret.
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues a fresh token for the user and invalidates any earlier one, so only the newest emailed
 * link works. Also sweeps expired rows, which nothing else would ever delete.
 */
export async function issuePasswordResetToken(
  userId: string,
  now: Date = new Date()
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000);
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { OR: [{ userId }, { expiresAt: { lt: now } }] } }),
    prisma.passwordResetToken.create({ data: { userId, tokenHash: hashResetToken(token), expiresAt } }),
  ]);
  return { token, expiresAt };
}

/** The live (unexpired) token row for a raw token, or null. Expired and unknown are indistinguishable by design. */
export async function findValidResetToken(token: string): Promise<{ id: string; userId: string } | null> {
  if (!token || token.length > 200) return null;
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: { id: true, userId: true, expiresAt: true },
  });
  if (!row || row.expiresAt <= new Date()) return null;
  return { id: row.id, userId: row.userId };
}

/** Kills any outstanding reset links, e.g. when the password is changed some other way. */
export async function deletePasswordResetTokensForUser(userId: string): Promise<void> {
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
}

export async function sendPasswordResetEmail(params: {
  to: string;
  name: string;
  token: string;
  expiresAt: Date;
}): Promise<{ success: boolean; error?: string }> {
  try {
    // Lazy: constructing Resend at module scope throws during CI's static collection (see email.md).
    const resend = new Resend(process.env.RESEND_API_KEY);
    const baseUrl = process.env.NEXTAUTH_URL ?? "https://www.jedforge.com";
    const html = await render(
      PasswordResetEmail({
        name: params.name,
        resetUrl: `${baseUrl}/reset-password/${params.token}`,
        expiresAt: params.expiresAt,
      })
    );
    const result = await resend.emails.send({
      from: RESET_FROM,
      to: params.to,
      subject: "Reset your JedForge password",
      html,
    });
    if (result.error) return { success: false, error: result.error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

/**
 * Everything that depends on whether the account exists. The request action runs this AFTER it has
 * answered (`after()`), so how long the response takes cannot reveal whether an email is registered.
 */
export async function processPasswordResetRequest(email: string, ip?: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, name: true, email: true },
  });
  if (!user) return;

  const { token, expiresAt } = await issuePasswordResetToken(user.id);
  securityEvent("auth.password_reset_requested", { targetUserId: user.id, ip });

  const sent = await sendPasswordResetEmail({ to: user.email, name: user.name, token, expiresAt });
  if (!sent.success) {
    // The error text can echo provider detail; logError summarises it. The link is useless unsent.
    logError("password reset email failed", new Error(sent.error ?? "send failed"));
    await prisma.passwordResetToken.deleteMany({ where: { tokenHash: hashResetToken(token) } });
  }
}
