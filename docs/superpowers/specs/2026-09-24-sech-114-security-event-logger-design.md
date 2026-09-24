# SECH-114 — Structured security-event logger with request/correlation IDs

Date: 2026-09-24
Ticket: SECH-114 (Plan ref SH-030 task 3). Phase 4 epic: SECH-100.
Status: approved design, ready for implementation planning.

## Problem

Security signals in this codebase are ad-hoc and unfilterable:

- `logAuthFailure()` (`src/lib/rate-limit.ts:182`) — `console.warn("[security] …")`, four
  call sites in `src/lib/auth.ts` and `src/lib/v1-auth.ts`.
- The monitor-mode warning at `src/lib/rate-limit.ts:105`.
- `[csp-report]` at `src/app/api/csp-report/route.ts:71`.

There is no request or correlation ID anywhere in `src/`, and no common event shape, so
events cannot be filtered, counted or alerted on reliably. Four later tickets — SECH-115
(central redaction), SECH-116 (error tracking), SECH-117 (owner alerting) and SECH-120
(post-deploy smoke checks) — all need a stable event schema to build against. This ticket
is the keystone: it fixes the schema and the correlation ID, not the coverage.

## Goals

1. A `securityEvent(type, meta)` helper emitting single-line JSON with a stable schema.
2. A request/correlation ID generated or propagated in middleware, present on every event
   and on every response.
3. Every existing ad-hoc security log converted to the new shape, with a guard test that
   stops ad-hoc logging from reappearing.
4. Coverage of the event categories listed in the ticket.

## Non-goals

- **Central log redaction** — that is SECH-115. It installs behind this design's `emit()`
  seam. This ticket owes only that it does not itself create a leak.
- **Alerting, thresholding or burst detection** — SECH-117. See "Denial policy" below for
  why this is deliberate rather than deferred-by-omission.
- **Error tracking / exception capture** — SECH-116.
- **Replacing the admin audit log.** See below.

## Prior art already in the repo

`src/lib/audit-log.ts` already exists. `logAdminAction()` writes durable `AdminAuditLog`
rows (actor id/name/email, action, target, metadata), surfaced in the admin UI at
`/admin/audit-log`, with 17 call sites in `src/app/(dashboard)/admin/actions.ts`. Its
`AuditAction` enum already covers `ROLE_CHANGED`, `ORG_MEMBER_ADDED`,
`ORG_MEMBER_REMOVED`, `PASSWORD_RESET`, `PROJECT_DELETED` and more — that is two of the
nine categories SECH-114 lists ("admin actions", "org/project membership and role
changes"), already implemented in a better form than a log line.

**Decision: keep both, and bridge them.** They solve different problems:

| | `logAdminAction` | `securityEvent` |
|---|---|---|
| Purpose | Durable, attributable audit trail | Detection stream |
| Actor | Always known | Usually absent (pre-auth events) |
| Storage | `AdminAuditLog` DB rows | stdout JSON |
| Reader | Human, in the admin UI | SECH-116/117 |

`logAdminAction()` gains one call to `securityEvent()`. That is a single edit in a single
file, and all 17 admin actions appear in the detection stream with a correlation ID
without duplicating the enum or touching `admin/actions.ts`.

Rejected: folding admin actions into `securityEvent` only (loses durability and the admin
UI), and making `securityEvent` write DB rows (turns unauthenticated endpoints such as
`csp-report` into a write amplifier — the exact failure mode that route was already
hardened against).

## Design

### 1. Event record

```jsonc
{
  "evt": "security",              // fixed discriminator
  "ts": "2026-09-24T14:35:30.123Z",
  "type": "auth.login_failed",    // from the closed catalog
  "severity": "warn",             // info | warn | critical
  "requestId": "0f8c…",
  "userId": "cmo3…",              // omitted when unauthenticated
  "orgId": "cmsq…",               // omitted when not org-scoped
  "ip": "203.0.113.4",
  "meta": { "reason": "invalid_credentials" }
}
```

Caller data is **nested under `meta`, not spread onto the record**. Spreading reads better
but lets a caller key silently clobber `type` or `severity`, which is unacceptable for
fields SECH-117 writes alert rules against.

`evt: "security"` exists because Railway's stream mixes Next.js output, framework noise and
ours. One fixed token makes the security stream filterable without matching a dozen type
prefixes.

Severity is a property **of the event type**, looked up from the catalog — not an argument
a call site passes and gets wrong.

### 2. Event catalog

A closed TypeScript union, pinned by a guard test so that adding a type is a deliberate,
reviewable diff. A free-form string would let a typo silently create an event type no alert
rule matches — a failure discovered only during an incident.

Phase 1 (converted from existing ad-hoc logging):

| Type | Severity | Source |
|---|---|---|
| `auth.login_failed` | warn | `src/lib/auth.ts` |
| `auth.login_throttled` | warn | `src/lib/auth.ts` |
| `auth.v1_key_invalid` | warn | `src/lib/v1-auth.ts` |
| `auth.v1_throttled` | warn | `src/lib/v1-auth.ts` |
| `ratelimit.monitor_would_block` | info | `src/lib/rate-limit.ts` |
| `csp.violation` | info | `src/app/api/csp-report/route.ts` |

Phase 2 (net-new emissions):

| Type | Severity | Source |
|---|---|---|
| `authz.denied_not_member` | warn | `permissions.ts` |
| `authz.denied_private_project` | warn | `permissions.ts` |
| `authz.denied_not_org_member` | warn | `permissions.ts` |
| `authz.denied_role` | info | `permissions.ts` |
| `authz.denied_admin` | warn | `permissions.ts` |
| `oauth.token_failed` | warn | `api/oauth/token/route.ts` |
| `oauth.refresh_reuse_detected` | critical | `api/oauth/token/route.ts` |
| `apikey.created` | info | `org-settings/actions.ts:64` |
| `apikey.revoked` | info | `org-settings/actions.ts:118`, `credential-revocation.ts:24` |
| `apikey.used_after_revoke` | critical | `external-api-auth.ts` |
| `session.invalidated` | info | `admin/actions.ts:95`, `:147`, `settings/actions.ts:47` |
| `upload.rejected` | warn | `upload-validation.ts` callers |
| `admin.action` | info | `audit-log.ts` bridge |

### 3. Denial policy — classify, do not sample

The ticket says "authorization denials (sampled or thresholded)". Both framings are
rejected, deliberately.

`requireProjectRole` throws for six reasons that differ enormously in value:

| Denial | Normal volume | Signal | Emitted? |
|---|---|---|---|
| Not a project member | Rare | Very high — cross-tenant probe | Yes, `warn` |
| No access to private project | Rare | Very high | Yes, `warn` |
| `Forbidden` (role too low) | Low | Medium | Yes, `info` |
| Project not found | Moderate | Low | No |
| Project is closed | Moderate | None — normal navigation | **No** |
| Unauthorized (no session) | Very high | None — expired sessions | **No** |

`requireOrgRole` and `requireAdmin` follow the same classification: a membership
denial emits (`authz.denied_not_org_member`, warn), a role denial emits
(`authz.denied_role` / `authz.denied_admin`), and a missing session does not emit.

Uniform sampling drops precisely the events worth having: a 1-in-10 sample of a population
dominated by expired sessions reliably captures expired sessions and reliably misses the
single cross-tenant probe. Classifying by reason and **not emitting the two high-volume
zero-signal denials at all** removes the volume problem that sampling exists to solve.

Thresholding stays out of the emitter and belongs in SECH-117. It is policy — "alert when
one actor trips 20 of these in 5 minutes" — and policy should be tunable without a deploy.
Holding per-actor counters in the emitter would also make them per-instance, and therefore
wrong, on a platform that restarts and scales processes freely.

Accepted tradeoff: until SECH-117 exists, a tenancy denial in a retry loop emits one line
per attempt. The existing rate limiters cap the underlying request rate at the edges that
matter.

### 4. Request / correlation ID

New module `src/lib/request-id.ts`, deliberately dependency-free so Edge middleware stays
light.

- Middleware reads inbound `x-request-id`, **validates it against a strict UUID pattern**,
  and generates a fresh `crypto.randomUUID()` otherwise. The value lands in a log stream,
  so an unvalidated inbound header is a log-injection vector; regenerating on anything
  malformed costs two lines and keeps the door open to a real upstream trace ID later.
- Set on the **request** headers (the established `x-pathname` pattern in
  `src/middleware.ts`) and on the **response** headers for *every* response. That satisfies
  the ticket's "include it in error responses" without touching a single route handler, and
  yields correlation on successful requests for free.
- Read by API routes from `request.headers`, and by Server Actions via `await headers()` —
  mirroring the existing `getClientIp` / `clientIpFromHeaders` pair.

**The `/api/auth` gap.** The middleware matcher is:

```
"/((?!api/auth|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
```

`api/auth` is excluded, and login failures are emitted from the `authorize` callback in
`src/lib/auth.ts`, reached via `/api/auth/callback/credentials`. The highest-value event
source is therefore the one path middleware never runs on. Widening the matcher to cover
NextAuth's routes is rejected: that is a live auth path and the blast radius of a
middleware bug there is total lockout.

Instead, `securityEvent()` **lazily generates an ID when none is present in context**. Every
event carries a correlation ID regardless; middleware's role is making one ID span
*multiple* events within a request, not being the sole source.

### 5. Module layout

`src/lib/security-events.ts` — the catalog, the severity map, `securityEvent()`, and a
single private `emit()` performing `console.warn(JSON.stringify(record))`.

That one seam is where SECH-115 inserts redaction and SECH-117 adds a sink: one file, not
150 call sites. A full pluggable-sink registry was rejected as speculative generality; the
single indirection captures its value at a fraction of the cost. A logging library (pino)
was rejected because it adds a runtime dependency that must clear the pinning rule and the
`Dependency audit` gate, and its transport machinery is awkward across Next's Node and Edge
runtimes — and middleware, where the request ID is born, is Edge.

### 6. Phase 1 conversions

`logAuthFailure()` is **deleted, not wrapped**. A compatibility wrapper would leave two
shapes in the codebase, which is the condition this ticket exists to end.

Cost, stated plainly: it is mocked in four test files (`src/lib/__tests__/v1-auth.test.ts`,
`src/__tests__/session-invalidation.test.ts`,
`src/__tests__/cleanup-orphaned-attachments.test.ts`, `src/__tests__/tenancy.test.ts`) and
`v1-auth.test.ts` asserts against the mock, so those need updating. Per CLAUDE.md's
pre-commit checklist and the JFR-131 stale-mock incident, `npm test` runs locally before
pushing rather than relying on CI as the backstop.

The `csp-report` route's existing `scrub()` is unchanged — it already strips query strings
from `document-uri` / `blocked-uri`, which is exactly right.

### 7. Testing

Following the house guard-test pattern (`constant-time-secrets.test.ts`,
`rich-text-sinks.test.ts`, `security-headers.test.ts`, `authz-matrix.test.ts`):

1. **Shape test** — every catalog type emits parseable single-line JSON carrying the
   required fields, an ISO 8601 `ts`, and the severity the catalog assigns it.
2. **Catalog guard** — the event-type set is explicitly pinned, so adding one is a
   deliberate reviewable diff.
3. **Anti-regression guard** — fails if `console.warn("[security]` or `[csp-report]`
   reappears outside `security-events.ts`. This is what stops the ticket silently
   un-landing later.
4. **Request-ID tests** — generates when absent; propagates a valid inbound UUID;
   regenerates a malformed one; sets the response header.
5. **Updated mocks** in the four files above.

### 8. Boundary with SECH-115 (redaction)

This ticket does not implement redaction. What it owes is not creating a leak: no token,
secret, presigned URL or password reaches `meta` from any call site added here.

One judgment call recorded deliberately: **the login-failure event keeps logging `email`**,
as `logAuthFailure` does today. Without it, credential stuffing is indistinguishable from
one person mistyping their password. It is existing behavior and standard for auth logs.
SECH-115 should make an explicit decision about it rather than have it quietly changed
here.

## Phasing

**Phase 1 — schema and plumbing.** The module, the catalog, the severity map, middleware
request ID, the propagation helpers, and conversion of the six existing ad-hoc sites. Net
behavior change: the same events, in a new shape, now correlated.

**Phase 2 — net-new emissions.** Authz denials, OAuth token failures and refresh reuse, API
key lifecycle, session-invalidation triggers, upload rejections, and the `logAdminAction`
bridge.

The split is at that point because SECH-115/116/117/120 depend on the *schema* being frozen,
not on call-site coverage. Phase 1 unblocks them while Phase 2 is still in review, and if
the schema proves wrong it is discovered on a small PR rather than a fifteen-file one.

Accepted cost: the stream is incomplete between the two merges. Nothing consumes it yet, so
this is free.

## Risks

- **Middleware touches every request in the app.** The edit stays three lines, synchronous,
  with no imports beyond the zero-dependency `request-id` helper.
- **Log volume** if a denial category is misclassified. Mitigated by the classification
  table in section 3 and by excluding the two zero-signal denials outright.
- **Stale test mocks** — the JFR-131 failure mode. Mitigated by running `npm test` locally
  before pushing.

## Acceptance criteria

- `securityEvent()` exists, emits single-line JSON matching the schema, and is the only
  place security events are written.
- A request ID is generated or propagated in middleware, appears on every response, and
  appears on every emitted event including those from `/api/auth`.
- All six pre-existing ad-hoc security logs are converted; `logAuthFailure` is gone.
- The guard test fails if ad-hoc `[security]` / `[csp-report]` logging reappears.
- Every event category listed in the ticket emits, with admin actions and
  membership/role changes arriving via the `logAdminAction` bridge.
- `npm run lint`, `npx tsc --noEmit`, `npm test` and `npm run test:integration` all clean.
