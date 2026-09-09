import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { checkRateLimit, recordFailure, getClientIp, logAuthFailure, V1_API_RATE_LIMIT } from "./rate-limit";

export async function requireV1ApiKey(request: Request): Promise<Response | null> {
  const apiKey = process.env.V1_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "V1_API_KEY environment variable is not configured" },
      { status: 500 }
    );
  }

  const ip = getClientIp(request);
  const key = `v1api:${ip}`;

  const limit = await checkRateLimit(key, V1_API_RATE_LIMIT);
  if (!limit.allowed) {
    logAuthFailure({ scope: "v1-api", reason: "rate_limited", ip });
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
    logAuthFailure({ scope: "v1-api", reason: "invalid_key", ip });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
