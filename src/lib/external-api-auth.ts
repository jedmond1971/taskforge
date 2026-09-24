import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashApiKey } from "@/lib/api-keys";
import { checkRateLimit, consumeRateLimit, getClientIp, recordFailure, LIMITS } from "@/lib/rate-limit";
import { securityEvent } from "@/lib/security-events";
import { requestIdFromHeaders } from "@/lib/request-id";

function tooMany(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too Many Requests" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export type ExternalApiContext = { orgId: string; apiKeyId: string; createdById: string };

export async function requireExternalApiKey(
  request: Request
): Promise<ExternalApiContext | NextResponse> {
  // SECH-107: durable limits (the previous in-memory Map reset on every deploy).
  // Bad keys are failure-counted per IP; valid keys are attempt-counted per key.
  const ipKey = `extapi-auth-ip:${getClientIp(request)}`;
  const ipLimit = await checkRateLimit(ipKey, LIMITS.externalApiAuthFailuresPerIp);
  if (!ipLimit.allowed) return tooMany(ipLimit.retryAfterSeconds);

  const incoming = request.headers.get("X-Api-Key");
  if (!incoming) {
    await recordFailure(ipKey, LIMITS.externalApiAuthFailuresPerIp.windowMs);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hashed = hashApiKey(incoming);
  const key = await prisma.apiKey.findUnique({
    where: { hashedKey: hashed },
    select: { id: true, orgId: true, revokedAt: true, createdById: true },
  });

  // SECH-114: a revoked key still being presented is a different signal from an unknown
  // one — the holder has not noticed, or is not who we revoked it from. The 401 below is
  // deliberately identical for both, so only the log distinguishes them.
  if (key && key.revokedAt !== null) {
    securityEvent("apikey.used_after_revoke", {
      requestId: requestIdFromHeaders(request.headers),
      orgId: key.orgId,
      meta: { apiKeyId: key.id },
    });
  }

  if (!key || key.revokedAt !== null) {
    await recordFailure(ipKey, LIMITS.externalApiAuthFailuresPerIp.windowMs);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keyLimit = await consumeRateLimit(`extapi:${key.id}`, LIMITS.externalApiPerKey);
  if (!keyLimit.allowed) return tooMany(keyLimit.retryAfterSeconds);

  // Fire-and-forget: update lastUsedAt without blocking the response
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { orgId: key.orgId, apiKeyId: key.id, createdById: key.createdById };
}
