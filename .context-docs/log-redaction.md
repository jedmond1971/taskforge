# Log and error redaction (SECH-115)

Application code never calls `console.*`. `logError()` and `redact()` are the way.

## The three leak sources, measured

The ticket assumed the job was auditing our own call sites. Measured against a production
build (Next 16.3.4 / Prisma 5.22.0), that was the least dangerous third:

| # | Source | Fires when | Fixed by converting our call sites? |
|---|---|---|---|
| 1 | `prisma:error` — Prisma's own logger | **Always**, even when the caller catches | **No** |
| 2 | `⨯ Error […]` — Next's uncaught-error logger | The route does not catch | **No** |
| 3 | `console.error(error)` — 68 sites in 41 files | We catch and log | Yes |

`PrismaClientValidationError.message` embeds the whole `data:` object verbatim, so a marker
string appeared **twice per request** from sources 1 and 2 together. The client was never
affected — the browser got a bare 500. This is purely server-log exposure.

**Three things that look like fixes and are not:**

- **`errorFormat: "minimal"` does not strip the data block.** Tested against both settings;
  the pretty-printed payload survives in the thrown message.
- **Prisma logs via `console.log`, not `console.error`.** A patch wrapping only `console.error`
  — the natural instinct — misses source 1 entirely while appearing to work.
- **Catching the error does not help.** Source 1 fires from inside the Prisma client.

## How each source is closed

1. **Prisma** (`src/lib/prisma.ts`) — production uses `log: [{ emit: "event", level: "error" }]`
   with a handler that emits a summary. Event-based logging still delivers validation errors,
   carrying `target` (the operation), and nothing goes to stdout. Development keeps
   `["query", "error", "warn"]` deliberately: the full payload is what you want when debugging.
2. **Next's logger** (`src/instrumentation.ts`) — a production-only patch over `console.log`,
   `warn` and `error`. Idempotent (a second install cannot double-wrap) and fail-open (if
   redaction throws, the original is logged — a dropped error log is worse than an unredacted
   one).
3. **Our call sites** — `logError(context, error, extra?)` from `src/lib/security-events.ts`,
   enforced by `src/__tests__/console-sinks.test.ts`.

## Prisma errors are discarded and summarised, not scrubbed

`summarizeError()` keeps the error class, `target` (operation), `code` (or `errorCode`, which
is where `PrismaClientInitializationError` puts it), and `meta.target` column names when every
element is a plain identifier.

**The message is dropped by SHAPE, not by error class.** Only the
`` Invalid `prisma.X()` invocation `` form embeds a `data:` block. Dropping by class name was a
real blind spot: connection, timeout and Rust-panic messages carry no payload, so discarding
them meant a production database outage logged `{"messageDropped":true}` and nothing else —
the on-call engineer had no signal at all.

Scrubbing it was rejected: it is a pre-rendered string with no keys left to match, document
body is arbitrary text with no pattern, and a regex over Prisma's formatting would break
silently the day Prisma changes it. Summarising fails safe.

Operational Prisma errors and all non-Prisma errors keep a redacted, capped `message` **and
`stack`**. `stack` is listed in `RedactOptions.uncappedKeys` by `securityEvent`, because the
200-char `meta` cap would otherwise cut a stack back to roughly one frame. This matters more than it
looks: `Error`'s `message` and `stack` are **non-enumerable**, so an earlier version that
treated an Error as a plain object silently stripped both from every error in production. The
log looked present and said nothing. `redact()` now routes `Error` instances through
`summarizeError()`.

## The never-log list

**Key-based** (`SENSITIVE_KEYS`): password, passwordHash, newPassword, currentPassword, secret,
clientSecret, codeVerifier, code_verifier, token, accessToken, refreshToken, apiKey, hashedKey,
hashedToken, authorization, cookie, email, content, description, body.

**Bare `code` is deliberately NOT on the list.** It collides with Prisma's `P2002`, the
diagnostic this work exists to preserve. Over-redaction is a silent failure — nobody notices
until an incident, when the logs turn out to say nothing.

**Value-based**: JWTs, `Authorization: Bearer|Basic`, presigned S3 URLs (any URL carrying
`X-Amz-Signature`/`X-Amz-Credential` keeps origin+path, drops the query), `jfk_live_` keys
(prefix kept), and the literal runtime values of `AUTH_SECRET`, `NEXTAUTH_SECRET`,
`V1_API_KEY`, `RESEND_API_KEY`, `RAILWAY_BUCKET_SECRET_ACCESS_KEY`, `DATABASE_URL` — guarded by
a 16-character minimum so an empty or short variable cannot become a match-everything rule.

**No generic high-entropy matching.** Cuids are 25-character alphanumeric strings; an entropy
heuristic would redact every id in every log line.

The `Authorization` rules are two deliberately narrow patterns, not one broad one: a
case-sensitive `Bearer|Basic` + 16-char-minimum credential, plus a separate case-insensitive
match on the header *name*. A single case-insensitive `\b(Bearer|Basic)\s+\S+` ate the word
after any prose use of "Basic" — "Basic validation failed" became "Basic [redacted] failed".

## Types the generic walk gets wrong

`redact()` special-cases these because `Object.keys()` gives the wrong answer for them:

| Type | Why | Result |
|---|---|---|
| `Error` | `message`/`stack` are non-enumerable | routed through `summarizeError()` |
| `Buffer` / TypedArray | keys are byte indices — 1 MB cost ~270 ms of blocking CPU | `[binary N bytes]` |
| `Date` | no own-enumerable state; Prisma records carry `createdAt`/`updatedAt` | ISO string |
| `Map` / `Set` | no own-enumerable state | array form |
| `URL` | no own-enumerable state | `redactUrlForLog()` |

Cycle detection tracks the **ancestor path**, not every object visited: a visit set that is
never unwound reports the same object appearing under two sibling keys as a cycle and deletes
its content.

## The cap is opt-in

`redact(value, { maxStringLength })` truncates only when asked. It must stay that way: the
console patch redacts whole log lines, so a default cap would silently truncate every
production log line over the limit. Only `securityEvent`'s `meta` opts in (200 chars).

## `email`

Redacted by default. The login-failure event opts in explicitly via the `emailAttempted` meta
key — without the address, credential stuffing is indistinguishable from one person mistyping
their password. That is the one documented exception; adding another means renaming the key so
the opt-in stays greppable.

## Adding a sensitive key or pattern

1. Add to `SENSITIVE_KEYS` (lowercase) or the pattern list in `src/lib/redaction.ts`.
2. **Check it does not collide with a diagnostic field.** `code` is the cautionary example.
3. Add a case to `src/test-support/secret-payloads.ts`, and if the value could plausibly be
   confused with something legitimate, add a `MUST_SURVIVE` entry too.
4. If it is a realistic-looking secret, the `Secret scan` job will flag the fixture — the
   corpus paths are already allowlisted in `.gitleaks.toml`. **Never put a real credential
   there**; removing a secret from history does not un-leak it.

## Guard tests

| Test | What breaks it |
|---|---|
| `lib/__tests__/redaction.test.ts` | a corpus secret surviving; a `MUST_SURVIVE` value being redacted; a cycle/BigInt/throwing getter propagating |
| `lib/__tests__/prisma-logging.test.ts` | production Prisma reverting to stdout logging |
| `__tests__/console-patch.test.ts` | a console method left unwrapped; double-wrapping; truncation; failing closed |
| `__tests__/console-sinks.test.ts` | a `console.*` call or bare reference outside the allowlist |
