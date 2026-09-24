/**
 * Central log/error redaction (SECH-115).
 *
 * Two modes, because leaks arrive in two shapes: key-based scrubbing for structured
 * objects, and pattern-based scrubbing for strings that have no keys left (a rendered
 * error message, an echoed header).
 *
 * Deliberately NO generic high-entropy matching: cuids are 25-char alphanumeric strings,
 * so an entropy heuristic would redact every id in every log line and leave the logs
 * useless. Specific shapes only.
 *
 * This module must not import anything from the app. security-events.ts imports it, so
 * an app import here would create a cycle that ESM resolves to undefined at init time.
 */

export const REDACTED = "[redacted]";

/** Minimum length before an env var's value is treated as a literal secret to scrub. */
const MIN_ENV_SECRET_LENGTH = 16;

/** Env vars whose literal VALUES must never appear in a log line. */
export const SECRET_ENV_VARS = [
  "AUTH_SECRET",
  "NEXTAUTH_SECRET",
  "V1_API_KEY",
  "RESEND_API_KEY",
  "RAILWAY_BUCKET_SECRET_ACCESS_KEY",
  "DATABASE_URL",
];

const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const AUTH_HEADER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._\-+/=]{8,}/gi;
const API_KEY_RE = /\bjfk_live_[A-Za-z0-9_-]{8,}/g;
const PRESIGNED_RE = /https?:\/\/[^\s"']+[?&]X-Amz-(?:Signature|Credential)=[^\s"']*/gi;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactString(input: string, envVars: string[] = SECRET_ENV_VARS): string {
  let out = input
    .replace(PRESIGNED_RE, (url) => {
      try {
        const u = new URL(url);
        return `${u.origin}${u.pathname}?${REDACTED}`;
      } catch {
        return REDACTED;
      }
    })
    .replace(JWT_RE, REDACTED)
    .replace(AUTH_HEADER_RE, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(API_KEY_RE, `jfk_live_${REDACTED}`);

  for (const name of envVars) {
    const value = process.env[name];
    // A short or unset variable would otherwise become a match-everything rule.
    if (!value || value.length < MIN_ENV_SECRET_LENGTH) continue;
    out = out.replace(new RegExp(escapeRegExp(value), "g"), REDACTED);
  }

  return out;
}

/**
 * Keys whose VALUES never reach a log.
 *
 * `code` is deliberately absent: it collides with Prisma's error code (P2002), which is
 * the diagnostic this whole ticket exists to preserve. OAuth's authorization code is
 * covered by codeVerifier/code_verifier and by call sites not passing it.
 */
export const SENSITIVE_KEYS = new Set(
  [
    "password",
    "passwordhash",
    "newpassword",
    "currentpassword",
    "secret",
    "clientsecret",
    "codeverifier",
    "code_verifier",
    "token",
    "accesstoken",
    "refreshtoken",
    "apikey",
    "hashedkey",
    "hashedtoken",
    "authorization",
    "cookie",
    "email",
    "content",
    "description",
    "body",
  ].map((k) => k.toLowerCase())
);

/** Cap applied to attacker-influenced strings (SECH-114 inherited item). Opt-in only. */
export const MAX_STRING_LENGTH = 200;
/** Stacks are long by nature and worth more room than a meta value. */
const MAX_STACK_LENGTH = 2000;
const MAX_DEPTH = 8;

export interface RedactOptions {
  /**
   * Truncate strings at this length. Left OFF by default on purpose: the console patch
   * redacts whole log lines, and a default cap would silently truncate every line over
   * the limit in production. Only securityEvent's `meta` opts in.
   */
  maxStringLength?: number;
}

function capString(s: string, max?: number): string {
  if (!max || s.length <= max) return s;
  return `${s.slice(0, max)}…[truncated]`;
}

export function redact(value: unknown, opts: RedactOptions = {}): unknown {
  return redactInner(value, 0, new WeakSet(), opts);
}

function redactInner(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  opts: RedactOptions
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return capString(redactString(value), opts.maxStringLength);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value !== "object") return REDACTED;

  // An Error's `message` and `stack` are NON-ENUMERABLE, so treating one as a plain
  // object silently drops both — and Next.js logs uncaught errors as objects, so every
  // error would arrive as {name} and nothing else. Route them through the summariser,
  // which keeps what is safe and drops only the Prisma payload.
  if (value instanceof Error) return summarizeError(value);

  if (depth >= MAX_DEPTH) return "[depth-capped]";
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => redactInner(v, depth + 1, seen, opts));

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    try {
      out[key] = redactInner((value as Record<string, unknown>)[key], depth + 1, seen, opts);
    } catch {
      // A throwing getter must not take the whole log line with it.
      out[key] = "[unreadable]";
    }
  }
  return out;
}

/** Prisma renders the whole `data:` object into validation messages — never log one. */
const PRISMA_ERROR_NAMES = new Set([
  "PrismaClientValidationError",
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientInitializationError",
  "PrismaClientRustPanicError",
  "PrismaClientError",
]);

/** Column names are safe; values are not. */
const IDENTIFIER_RE = /^[A-Za-z0-9_]+$/;

/**
 * Turns an unknown thrown value into a loggable summary.
 *
 * For Prisma errors the message is DISCARDED, not scrubbed: it is a pre-rendered string
 * with no keys left to match, document body is arbitrary text with no pattern, and a
 * regex over Prisma's formatting would break silently the day Prisma changes it. What
 * survives — operation, code, column names — is what you actually need to debug.
 */
export function summarizeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { name: typeof error, message: redact(error) };
  }

  const e = error as Error & {
    code?: unknown;
    meta?: { target?: unknown };
    clientVersion?: unknown;
  };
  const out: Record<string, unknown> = { name: e.name };

  if (typeof e.code === "string") out.code = e.code;

  const target = e.meta?.target;
  if (Array.isArray(target) && target.every((t) => typeof t === "string" && IDENTIFIER_RE.test(t))) {
    out.columns = target;
  }

  if (PRISMA_ERROR_NAMES.has(e.name)) {
    // `Invalid `prisma.docPage.create()` invocation` — the operation, without the payload.
    const op = /Invalid `prisma\.([A-Za-z0-9_.$]+)\(\)` invocation/.exec(e.message ?? "");
    if (op) out.target = op[1];
    out.messageDropped = true;
    return out;
  }

  out.message = capString(redactString(e.message ?? ""), MAX_STRING_LENGTH);
  // A stack is the other half of a useful error report. Redacted and capped, but kept:
  // dropping it is the over-redaction that makes a log look present and be useless.
  if (typeof e.stack === "string") out.stack = capString(redactString(e.stack), MAX_STACK_LENGTH);
  return out;
}
