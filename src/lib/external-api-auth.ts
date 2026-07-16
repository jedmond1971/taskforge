import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/api-keys";

// In-memory fixed-window rate limiter.
// Resets on redeploy/restart — acceptable for Railway Hobby (single instance).
// Known limitation: not distributed; replace with Redis if multi-instance.
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(apiKeyId: string): boolean {
  const now = Date.now();
  const state = rateLimitMap.get(apiKeyId);
  if (!state || now - state.windowStart >= RATE_WINDOW_MS) {
    rateLimitMap.set(apiKeyId, { count: 1, windowStart: now });
    return true;
  }
  if (state.count >= RATE_LIMIT) return false;
  state.count++;
  return true;
}

export type ExternalApiContext = { orgId: string; apiKeyId: string };

export async function requireExternalApiKey(
  request: Request
): Promise<ExternalApiContext | NextResponse> {
  const incoming = request.headers.get("X-Api-Key");
  if (!incoming) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hashed = hashApiKey(incoming);
  const key = await prisma.apiKey.findUnique({
    where: { hashedKey: hashed },
    select: { id: true, orgId: true, revokedAt: true },
  });

  if (!key || key.revokedAt !== null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkRateLimit(key.id)) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  // Fire-and-forget: update lastUsedAt without blocking the response
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { orgId: key.orgId, apiKeyId: key.id };
}
