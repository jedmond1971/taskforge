import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { checkRateLimit, recordFailure, getClientIp, V1_API_RATE_LIMIT } from "./rate-limit";
import { securityEvent } from "./security-events";
import { requestIdFromHeaders } from "./request-id";

export async function requireV1ApiKey(request: Request): Promise<Response | null> {
  const apiKey = process.env.V1_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "V1_API_KEY environment variable is not configured" },
      { status: 500 }
    );
  }

  const ip = getClientIp(request);
  const requestId = requestIdFromHeaders(request.headers);
  const key = `v1api:${ip}`;

  const limit = await checkRateLimit(key, V1_API_RATE_LIMIT);
  if (!limit.allowed) {
    securityEvent("auth.v1_throttled", { requestId, ip, meta: { reason: "rate_limited" } });
    return NextResponse.json(
      { error: "Too many failed attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const incomingKey = request.headers.get("X-Internal-Api-Key");
  if (!incomingKey) {
    await recordFailure(key, V1_API_RATE_LIMIT.windowMs);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keyBuf = Buffer.from(apiKey);
  const incomingBuf = Buffer.from(incomingKey);

  if (keyBuf.length !== incomingBuf.length || !timingSafeEqual(keyBuf, incomingBuf)) {
    await recordFailure(key, V1_API_RATE_LIMIT.windowMs);
    securityEvent("auth.v1_key_invalid", { requestId, ip, meta: { reason: "invalid_key" } });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
