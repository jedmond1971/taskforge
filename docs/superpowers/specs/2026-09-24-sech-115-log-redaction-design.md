# SECH-115 — Central log and error redaction

Date: 2026-09-24
Ticket: SECH-115 (Plan ref SH-030 task 4, plus the gate item "Security events are redacted").
Parent epic: SECH-100. Depends on SECH-114 (`securityEvent`, `emit()` seam).
Status: approved design, ready for implementation planning.

## Problem

Document content, and anything else passed to a Prisma write, currently reaches production
logs verbatim. This was measured, not assumed — see "Evidence" below. Three independent
sources leak, and the two most dangerous are ones no amount of careful call-site coding
prevents.

## Evidence (measured 2026-09-24, production build, Next 16.3.4 / Prisma 5.22.0)

A route performing `prisma.docPage.create({ data: { content: "<marker>", ... } })` against an
invalid schema, with the marker string chosen to be greppable:

| # | Source | Fires when | Fixed by converting our call sites? |
|---|---|---|---|
| 1 | `prisma:error` — Prisma's own logger | **Always**, even when the caller catches | **No** |
| 2 | `⨯ Error [...]` — Next.js's uncaught-error logger | The route does not catch | **No** |
| 3 | `console.error(error)` — our 68 call sites in 41 files | We catch and log | Yes |

`PrismaClientValidationError.message` embeds the whole `data:` object verbatim, so the marker
appeared **twice per request** from sources 1 and 2 together.

Three further measurements that rule out the obvious fixes:

- **`errorFormat: "minimal"` does not help.** The pretty-printed `data:` block survives
  verbatim in the thrown message. Tested directly against both settings.
- **Prisma's logger writes via `console.log`, not `console.error`.** A console patch wrapping
  only `console.error` — the natural instinct — misses source 1 entirely while appearing to
  work.
- **Event-based logging does deliver validation errors.** With
  `log: [{ emit: "event", level: "error" }]`, `$on("error")` receives them, carrying
  `target: "docPage.create"` — the operation name, with no data — and nothing prints to
  stdout. This is what makes the summarise-instead-of-scrub approach viable.

The client side is unaffected: the browser received a bare 500 with no marker. This is purely
server-log exposure.

## Goals

1. One redaction module, used by every logging path and reusable by SECH-116's `beforeSend`.
2. Close all three leak sources.
3. Audit and convert the existing `console.*` call sites, with a guard that keeps them converted.
4. Tests that feed real secret shapes — including a captured Prisma error string — through the
   redactor.

## Non-goals

- **Error tracking / `beforeSend` wiring** — SECH-116. Nothing is installed today; this ticket
  owes it a reusable `redact()`, not an integration.
- **Alerting** — SECH-117.
- **A logging facade replacing `console.*` everywhere.** Considered and rejected: it is a large
  refactor that still would not close sources 1 and 2, because Prisma and Next do not call our
  facade.

## Design

### 1. The never-log list

Two rule kinds, because the leaks come in two shapes.

**Key-based** (structured objects): `password`, `passwordHash`, `newPassword`,
`currentPassword`, `secret`, `clientSecret`, `codeVerifier`, `code_verifier`, `token`,
`accessToken`, `refreshToken`, `apiKey`, `hashedKey`, `hashedToken`, `authorization`,
`cookie`, and the content fields `content`, `description`, `body`.

**Bare `code` is deliberately NOT on this list.** It collides with Prisma's error `code`
(`P2002`), which is the single most useful diagnostic we are trying to preserve. Over-redaction
is a silent failure mode: nobody notices until an incident, when the logs turn out to say
nothing. OAuth's authorization code is covered by `codeVerifier`/`code_verifier` and by call
sites not passing it.

**Value-based** (strings):

- JWTs — `eyJ`-prefixed three-segment tokens.
- `Authorization: Bearer …` / `Basic …`.
- Presigned S3 URLs — any URL carrying `X-Amz-Signature` or `X-Amz-Credential`: keep
  `origin + pathname`, drop the query.
- Our own API keys — `jfk_live…`: keep the 8-character prefix, drop the remainder.

**Deliberately no generic high-entropy matching.** Cuids are 25-character alphanumeric
strings; an entropy heuristic would redact every id in every log line and make the logs
useless. Specific shapes only.

**Literal env-secret substitution.** Scrub any occurrence of the runtime *values* of
`AUTH_SECRET`, `NEXTAUTH_SECRET`, `V1_API_KEY`, `RESEND_API_KEY`,
`RAILWAY_BUCKET_SECRET_ACCESS_KEY` and `DATABASE_URL`. This catches leaks whose shape we failed
to anticipate. Guarded by a minimum length (16 chars) so an empty or trivially short variable
cannot become a match-everything rule.

### 2. `src/lib/redaction.ts`

`redact(value: unknown): unknown` — recursive; key-based scrubbing for objects, value-based for
strings, arrays mapped. Depth-capped, size-capped, cycle-safe. Offending values become
`"[redacted]"`.

`summarizeError(error: unknown): Record<string, unknown>` — the discard-and-summarise path.
Keeps the error class name, `target` (the Prisma operation), and `code` when present. Keeps
`meta.target` **only** when every element matches `/^[A-Za-z0-9_]+$/`, because for `P2002`
those are column names and that is the most useful part of a constraint violation. The rendered
message is dropped entirely.

Scrubbing the rendered Prisma message was rejected: it is a pre-rendered string with no keys
left to match, document body is arbitrary text with no pattern, and a regex over Prisma's
formatting breaks silently the moment Prisma changes it. Summarising fails safe.

**`email` is redacted by default.** This resolves one of SECH-114's inherited items: the
login-failure event opts in explicitly at its call site as a documented exception, rather than
email flowing freely through every log path. Default-deny with one named exception.

### 3. Adapter — Prisma (source 1)

`src/lib/prisma.ts` moves to `log: [{ emit: "event", level: "error" }]` with an
`$on("error", …)` handler that emits a summarised record through the security-event logger.
Development keeps its current `["query", "error", "warn"]` configuration.

Net effect: Prisma stops printing raw payloads, and we still learn that `docPage.create` failed
with a missing argument.

### 4. Adapter — console patch (source 2)

New `src/instrumentation.ts` (none exists today), **production only**, wrapping `console.log`,
`console.warn` and `console.error`.

`console.log` is non-negotiable — it is the method Prisma uses, and patching only `error` is
the mistake that looks correct and is not.

Requirements: idempotent (no double-patching across reloads), non-recursive (the patched
function must not re-enter itself), and **fail-open** — if redaction throws, log the original.
A silently dropped error log is worse than an unredacted one.

Development is deliberately unpatched: the full Prisma payload is exactly what you want when
debugging, and this is the tool you reach for when something is already wrong.

### 5. Adapter — our call sites (source 3)

`logError(context, error)` exported from the redaction module, and the 68 `console.error`
call sites across 41 files converted to it. Measured exactly: 69 `console.*` lines in `src/`
outside tests, of which one is the permitted `console.warn` inside `securityEvent`'s emitter. A guard test bans raw `console.*` in `src/` outside the
security-event emitter and the instrumentation patch, in the same shape as
`security-logging-sinks.test.ts`. Converting is mechanical; the guard is what keeps it
converted.

### 6. Items inherited from SECH-114

- **`meta` length cap** — attacker-influenced strings (`clientId`, `declaredType`, `email`)
  truncated at 200 characters inside `redact()`, closing the unbounded-log-line concern.
- **`scrub()` path prefixes** — the `csp-report` route's `TOKEN_PATH_PREFIXES` list moves onto
  the shared redactor so there is one list rather than two drifting copies.
- **`email` in login-failure events** — decided above: redacted by default, opted into
  explicitly at that one site.

### 7. Testing

Following the corpus pattern of `src/test-support/xss-payloads.ts`: one fixture of real secret
shapes driven through the redactor.

1. **Corpus test** — a real-shaped JWT, a presigned URL with `X-Amz-Signature`, an
   `Authorization` header, a `jfk_live` key, an env-secret value, and **a captured real Prisma
   validation error string** each go in and come out scrubbed.
2. **Under-redaction guard** — the Prisma summary still contains `code`, `target` and
   `meta.target` column names. Over-redaction is the failure nobody notices.
3. **Console-patch test** — all three of `log`/`warn`/`error` are wrapped; the patch is
   idempotent; redaction throwing still logs the original.
4. **Prisma adapter test** — an emitted error event produces a summarised record and does not
   contain the payload.
5. **Sink guard** — raw `console.*` outside the two allowed files fails the build.

## Phasing

**Phase 1 — the redactor and the two leaks nobody can code around.** `src/lib/redaction.ts`,
the Prisma event adapter, and the `instrumentation.ts` console patch, with the corpus and
under-redaction tests. This closes sources 1 and 2, which are the ones a careful caller cannot
avoid, and it is the part SECH-116 needs.

**Phase 2 — the call-site conversion.** `logError()` applied across the 68 sites, plus the sink
guard, plus the SECH-114 inherited items (meta length cap, `scrub()` prefix consolidation).

The split is there because Phase 1 is small, high-risk and worth reviewing on its own — a
mistake in the console patch or the Prisma switch degrades or silences logging globally —
while Phase 2 is a large, low-risk, mechanical diff. Reviewing them together would bury the
dangerous part in the boring part.

Accepted cost: between the merges, source 3 is still unconverted. Sources 1 and 2 dominate the
actual exposure, so ordering it this way closes the most risk first.

## Risks

- **The console patch is global and production-only**, so it is least exercised where
  misbehaviour would be noticed. Mitigated by feeding captured real strings through the tests
  rather than synthetic ones.
- **Switching Prisma to events risks losing error logging entirely** if the handler is wrong —
  a quieter failure than the leak it replaces. The adapter test asserts an event actually
  produces output.
- **Over-redaction** destroys debuggability silently. The `code`-collision rule and the
  under-redaction guard exist specifically for this.

## Acceptance criteria

- The marker test from "Evidence" no longer appears in production-build logs from any of the
  three sources.
- `redact()` and `summarizeError()` exist, are used by all three adapters and by
  `securityEvent`'s `emit()`, and are reusable by SECH-116.
- All 68 `console.error` call sites converted; the guard test fails if a raw one returns.
- Prisma error events still yield `target`, `code` and column names.
- `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run test:integration` all clean.
