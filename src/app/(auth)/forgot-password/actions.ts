"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { createHash } from "crypto";
import {
  clientIpFromHeaders,
  consumeRateLimit,
  tooManyAttemptsMessage,
  LIMITS,
} from "@/lib/rate-limit";
import { logError } from "@/lib/security-events";
import { normalizeEmail, processPasswordResetRequest } from "@/lib/password-reset";

type RequestResult = { success: true; message: string } | { success: false; error: string };

// The same words whether or not the address belongs to an account.
const GENERIC_MESSAGE = "If an account exists for that email, we've sent a link to reset your password.";

// Emails are PII and keys sit in a table: store a truncated digest, never the address.
const emailKey = (email: string) => createHash("sha256").update(email).digest("hex").slice(0, 32);

/**
 * Public (unauthenticated). Always answers with GENERIC_MESSAGE once the request is well-formed and
 * under its limits. Both limits are keyed on what the caller typed, never on whether an account
 * exists, and the account lookup, token and email all run in `after()` — so neither the message
 * nor the response time distinguishes a registered address (JFR-183).
 */
export async function requestPasswordReset(email: string): Promise<RequestResult> {
  const normalized = normalizeEmail(String(email ?? ""));
  if (normalized.length < 3 || normalized.length > 254 || !normalized.includes("@")) {
    return { success: false, error: "Enter a valid email address." };
  }

  const ip = clientIpFromHeaders(await headers());
  const ipLimit = await consumeRateLimit(`pw-reset-req-ip:${ip}`, LIMITS.passwordResetRequestPerIp);
  if (!ipLimit.allowed) return { success: false, error: tooManyAttemptsMessage(ipLimit.retryAfterSeconds) };
  const emailLimit = await consumeRateLimit(
    `pw-reset-req-email:${emailKey(normalized)}`,
    LIMITS.passwordResetRequestPerEmail
  );
  if (!emailLimit.allowed) return { success: false, error: tooManyAttemptsMessage(emailLimit.retryAfterSeconds) };

  after(async () => {
    try {
      await processPasswordResetRequest(normalized, ip);
    } catch (error) {
      logError("password reset request failed", error);
    }
  });

  return { success: true, message: GENERIC_MESSAGE };
}
