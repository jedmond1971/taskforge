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
 * Client IP for rate-limit keys (SECH-108). Uses the RIGHTMOST X-Forwarded-For entry —
 * the hop appended by the nearest proxy (Railway's edge), which a client cannot forge.
 * The leftmost entry is whatever the client sent if a proxy appends rather than replaces.
 *
 * Railway behaviour, verified against production 2026-09-22 (.context-docs/rate-limiting.md):
 * the edge currently overwrites XFF with the real client IP, so leftmost == rightmost today
 * and a spoofed XFF did not escape the v1 limiter. But Railway appended to client-supplied
 * XFF in 2024 and its staff guidance has changed since; rightmost is correct under both.
 * If a CDN/second proxy is ever put in front, this must be revisited (it would return the
 * CDN's IP and throttle all users behind one edge node together).
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor.split(",").map((h) => h.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last;
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
