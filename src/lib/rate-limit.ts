import { prisma } from "./prisma";

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
}

export const LOGIN_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
};

/**
 * Per-account ceiling that ignores IP (SECH-108). The ip+email limit above stops one
 * client hammering one account; this one stops a distributed attacker rotating through
 * many real IPs against the same account. Deliberately looser than LOGIN_RATE_LIMIT
 * because it is also a lockout lever: anyone who knows an email can hold that account's
 * logins closed for up to one window by failing 20 times.
 */
export const ACCOUNT_LOGIN_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 20,
  windowMs: 15 * 60 * 1000,
};

export const V1_API_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
};

/**
 * Client IP for rate-limit keys (SECH-108). Uses the LEFTMOST X-Forwarded-For entry.
 *
 * Railway's edge, verified against production 2026-09-22 (.context-docs/rate-limiting.md):
 * it discards any client-supplied XFF, writes the real client IP first, then APPENDS a
 * Railway-internal proxy hop that changes on every request. So:
 *   - leftmost  = real client IP, not spoofable (a spoofed XFF never reached the key);
 *   - rightmost = rotating internal hop — keying on it gives every request a fresh bucket
 *     and silently disables the limiter (this shipped briefly in f795573 and was reverted).
 * If Railway ever starts appending to a client-supplied XFF instead, leftmost becomes
 * spoofable; the IP-independent ACCOUNT_LOGIN_RATE_LIMIT still caps login guessing, and the
 * post-deploy re-verify recipe in rate-limiting.md detects the change.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "unknown";
}

function loginRateLimitKeys(ip: string, email: string) {
  return { pair: `login:${ip}:${email}`, account: `login-account:${email}` };
}

/** Both login limits (ip+email and account-only) must allow the attempt. */
export async function checkLoginRateLimit(
  ip: string,
  email: string
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const keys = loginRateLimitKeys(ip, email);
  const [pair, account] = await Promise.all([
    checkRateLimit(keys.pair, LOGIN_RATE_LIMIT),
    checkRateLimit(keys.account, ACCOUNT_LOGIN_RATE_LIMIT),
  ]);
  if (pair.allowed && account.allowed) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: false,
    retryAfterSeconds: Math.max(pair.retryAfterSeconds, account.retryAfterSeconds),
  };
}

export async function recordLoginFailure(ip: string, email: string): Promise<void> {
  const keys = loginRateLimitKeys(ip, email);
  await recordFailure(keys.pair, LOGIN_RATE_LIMIT.windowMs);
  await recordFailure(keys.account, ACCOUNT_LOGIN_RATE_LIMIT.windowMs);
}

export async function checkRateLimit(
  key: string,
  { maxAttempts, windowMs }: RateLimitConfig
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const windowStart = new Date(Date.now() - windowMs);

  const failureCount = await prisma.rateLimitAttempt.count({
    where: { key, createdAt: { gte: windowStart } },
  });

  if (failureCount < maxAttempts) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const oldest = await prisma.rateLimitAttempt.findFirst({
    where: { key, createdAt: { gte: windowStart } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  const resetAt = oldest ? oldest.createdAt.getTime() + windowMs : Date.now() + windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));

  return { allowed: false, retryAfterSeconds };
}

export async function recordFailure(key: string, windowMs: number): Promise<void> {
  await prisma.rateLimitAttempt.create({ data: { key } });
  await prisma.rateLimitAttempt.deleteMany({
    where: { key, createdAt: { lt: new Date(Date.now() - windowMs) } },
  });
}

export function logAuthFailure(meta: {
  scope: "login" | "v1-api";
  reason: "invalid_credentials" | "rate_limited" | "invalid_key";
  ip: string;
  email?: string;
}): void {
  console.warn(`[security] ${meta.scope} auth failure`, {
    ...meta,
    timestamp: new Date().toISOString(),
  });
}
