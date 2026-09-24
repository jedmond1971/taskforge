import { headers } from "next/headers";
import { requestIdFromHeaders } from "./request-id";

/**
 * Correlation id for Server Actions and route handlers (SECH-114).
 *
 * Kept out of request-id.ts on purpose: that module must stay import-free so Edge
 * middleware can use it, and next/headers is not available there.
 *
 * Returns undefined outside a request scope (tests, scripts, background jobs), where
 * headers() throws — securityEvent() then generates a one-off id, so an event is never
 * lost for want of a correlation id.
 */
export async function currentRequestId(): Promise<string | undefined> {
  try {
    return requestIdFromHeaders(await headers());
  } catch {
    return undefined;
  }
}
