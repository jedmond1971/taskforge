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
