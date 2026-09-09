import { prisma } from "./prisma";

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
}

export const LOGIN_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
};

export const V1_API_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
};

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
