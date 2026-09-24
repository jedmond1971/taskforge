/**
 * Request/correlation IDs (SECH-114).
 *
 * Imports nothing on purpose: this module is used from src/middleware.ts, which runs on
 * the Edge runtime. `crypto` here is the global Web Crypto, NOT node:crypto — the node
 * builtin is unavailable on Edge.
 */

export const REQUEST_ID_HEADER = "x-request-id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function randomRequestId(): string {
  return crypto.randomUUID();
}

export function isValidRequestId(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * An inbound id is honoured only if it is a well-formed UUID. Everything else is
 * replaced. The value is written into a log stream, so an unvalidated header is a
 * log-injection vector — a CRLF would forge a second, attacker-authored event line.
 * Validating rather than always regenerating keeps the door open to a real upstream
 * trace ID later.
 */
export function normalizeRequestId(inbound: string | null | undefined): string {
  return isValidRequestId(inbound) ? (inbound as string).toLowerCase() : randomRequestId();
}

export function requestIdFromHeaders(headers: Headers): string | undefined {
  const value = headers.get(REQUEST_ID_HEADER);
  return isValidRequestId(value) ? (value as string).toLowerCase() : undefined;
}
