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
// Case-SENSITIVE and length-floored: a case-insensitive `\b(Bearer|Basic)\s+\S+` ate the
// next word after any prose use of "Basic" ("Basic validation failed" -> "Basic [redacted]
// failed"). Real headers use the canonical casing and a long credential.
const AUTH_SCHEME_RE = /\b(Bearer|Basic)\s+([A-Za-z0-9._\-+/=]{16,})/g;
// Lowercase or odd-cased headers are caught by the header NAME instead, which is unambiguous.
// The value runs to the end of the line (or the closing quote in a serialised object) —
// `\S+` would capture only the scheme word and leave the credential behind it.
const AUTH_HEADER_RE = /(authorization\s*[:=]\s*)([^\r\n"',}]+)/gi;
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
    .replace(AUTH_HEADER_RE, (_m, prefix: string) => `${prefix}${REDACTED}`)
    .replace(AUTH_SCHEME_RE, (_m, scheme: string) => `${scheme} ${REDACTED}`)
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
  /**
   * Keys exempt from `maxStringLength`. A stack is long by nature; applying the 200-char
   * meta cap to it leaves roughly one frame, which is the "log present, says nothing"
   * failure this module exists to avoid.
   */
  uncappedKeys?: readonly string[];
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

  // Object.keys() on a Buffer/TypedArray returns byte indices — a 1 MB buffer became a
  // million-key object and ~270ms of blocking CPU on a live request path.
  if (ArrayBuffer.isView(value)) return `[binary ${(value as ArrayBufferView).byteLength} bytes]`;
  if (value instanceof ArrayBuffer) return `[binary ${value.byteLength} bytes]`;

  // These carry no own-enumerable state, so the generic walk collapsed them to {} — and
  // Prisma records carry createdAt/updatedAt, so any logged record lost its timestamps.
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[invalid date]" : value.toISOString();
  if (value instanceof Map) return redactInner(Array.from(value.entries()), depth, seen, opts);
  if (value instanceof Set) return redactInner(Array.from(value.values()), depth, seen, opts);
  if (value instanceof URL) return redactUrlForLog(value.toString());

  if (depth >= MAX_DEPTH) return "[depth-capped]";
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  // `seen` tracks the ANCESTOR path, not every object ever visited: an un-unwound visit set
  // reports the same object appearing under two sibling keys as a cycle and deletes it.
  if (Array.isArray(value)) {
    const arr = value.map((v) => redactInner(v, depth + 1, seen, opts));
    seen.delete(value as object);
    return arr;
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    const keyOpts = opts.uncappedKeys?.includes(key)
      ? { ...opts, maxStringLength: undefined }
      : opts;
    try {
      out[key] = redactInner((value as Record<string, unknown>)[key], depth + 1, seen, keyOpts);
    } catch {
      // A throwing getter must not take the whole log line with it.
      out[key] = "[unreadable]";
    }
  }
  seen.delete(value as object);
  return out;
}

/**
 * The ONLY Prisma message shape that embeds the `data:` object.
 *
 * Dropping by error-class name instead was a real blind spot: connection, timeout and panic
 * messages carry no payload, so discarding them left an outage logging nothing but
 * {"messageDropped":true} — a log that is present and says nothing.
 */
const PRISMA_INVOCATION_RE = /Invalid `prisma\.([A-Za-z0-9_.$]+)\(\)` invocation/;

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

  // PrismaClientInitializationError stores its code as `errorCode`, not `code`.
  const code = typeof e.code === "string" ? e.code : (e as { errorCode?: unknown }).errorCode;
  if (typeof code === "string") out.code = code;

  const target = e.meta?.target;
  if (Array.isArray(target) && target.every((t) => typeof t === "string" && IDENTIFIER_RE.test(t))) {
    out.columns = target;
  }

  const op = PRISMA_INVOCATION_RE.exec(e.message ?? "");
  if (op) {
    // The operation name, without the payload that follows it.
    out.target = op[1];
    out.messageDropped = true;
    return out;
  }

  out.message = capString(redactString(e.message ?? ""), MAX_STRING_LENGTH);
  // A stack is the other half of a useful error report. Redacted and capped, but kept:
  // dropping it is the over-redaction that makes a log look present and be useless.
  if (typeof e.stack === "string") out.stack = capString(redactString(e.stack), MAX_STACK_LENGTH);
  return out;
}

/**
 * Routes that carry a secret in the PATH, where dropping the query is not enough.
 * SECH-114 found this: an invite token lives in /invite/<token>, so a CSP violation
 * raised on an invite page wrote a live, unused token to the log stream.
 */
export const TOKEN_PATH_PREFIXES = ["/invite/"];

/** origin + path, with token-bearing prefixes redacted and the query dropped. */
export function redactUrlForLog(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const u = new URL(value);
    for (const prefix of TOKEN_PATH_PREFIXES) {
      if (u.pathname.startsWith(prefix)) return `${u.origin}${prefix}${REDACTED}`;
    }
    return `${u.origin}${u.pathname}`.slice(0, 200);
  } catch {
    return value.slice(0, 50); // CSP keywords like "inline", "eval", "data"
  }
}
