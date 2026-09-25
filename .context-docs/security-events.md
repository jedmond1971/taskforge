# Structured security events (SECH-114)

`securityEvent()` in `src/lib/security-events.ts` is the only place a security signal is
written. Everything below is enforced by tests; the "Adding an event type" section is the
part you will actually need.

## Record shape

One JSON line per event:

```jsonc
{
  "evt": "security",              // fixed discriminator — one grep token
  "ts": "2026-09-24T14:35:30.123Z",
  "type": "auth.login_failed",    // from the closed catalog below
  "severity": "warn",             // info | warn | critical
  "requestId": "0f8c…",
  "userId": "cmo3…",              // the ACTOR; omitted when unauthenticated
  "targetUserId": "cmo9…",        // the account acted UPON, when it differs from the actor
  "orgId": "cmsq…",               // omitted when not org-scoped
  "ip": "203.0.113.4",
  "meta": { "reason": "invalid_credentials" }
}
```

`evt: "security"` exists because Railway's stream mixes Next.js output, framework noise and
ours — one fixed token makes the security stream filterable without matching a dozen type
prefixes.

**Caller data is nested under `meta`, never spread onto the record.** Spreading reads better
but lets a caller key silently clobber `type` or `severity`, which are the fields alert rules
match on. A test pins this.

**`userId` always means the actor, never the subject.** An admin resetting someone's password
emits `userId` = admin, `targetUserId` = the account. Without the split, querying "what did this
account do?" returns events the account did not cause, and an SECH-117 rule counting per
`userId` conflates "this actor is noisy" with "this account is being acted upon". Where no
actor is in scope (`revokeApiKeysForUser`), only `targetUserId` is set and the acting admin is
recoverable from the `admin.action` event sharing the same `requestId`.

**Severity is a property of the event type**, read from `SECURITY_EVENT_SEVERITY`. Call sites
never pass a severity, so the same event cannot be reported at two severities from two places.

## Catalog

| Type | Severity | Emitted from |
|---|---|---|
| `auth.login_failed` | warn | `lib/auth.ts` |
| `auth.login_throttled` | warn | `lib/auth.ts` |
| `auth.v1_key_invalid` | warn | `lib/v1-auth.ts` |
| `auth.v1_throttled` | warn | `lib/v1-auth.ts` |
| `ratelimit.monitor_would_block` | info | `lib/rate-limit.ts` |
| `csp.violation` | info | `app/api/csp-report/route.ts` |
| `authz.denied_not_member` | warn | `lib/permissions.ts` |
| `authz.denied_private_project` | warn | `lib/permissions.ts` |
| `authz.denied_not_org_member` | warn | `lib/permissions.ts` |
| `authz.denied_role` | info | `lib/permissions.ts` |
| `authz.denied_admin` | warn | `lib/permissions.ts` |
| `oauth.token_failed` | warn | `app/api/oauth/token/route.ts` |
| `oauth.refresh_reuse_detected` | critical | `app/api/oauth/token/route.ts` |
| `apikey.created` | info | `app/(dashboard)/org-settings/actions.ts` |
| `apikey.revoked` | info | `org-settings/actions.ts`, `lib/credential-revocation.ts` |
| `apikey.used_after_revoke` | critical | `lib/external-api-auth.ts` |
| `session.invalidated` | info | `admin/actions.ts` (×2), `settings/actions.ts` |
| `upload.rejected` | warn | the 3 attachment routes + `editor-images` |
| `admin.action` | info | `lib/audit-log.ts` (bridge) |
| `admin.role_granted` | critical | `admin/actions.ts` (×2: create-as-ADMIN, role change to ADMIN) |

## Denial classification — why we do not sample

The ticket asked for authorization denials "sampled or thresholded". Both were rejected.

`resolveProjectRole` throws for six reasons that differ enormously in value:

| Denial | Normal volume | Signal | Emitted? |
|---|---|---|---|
| Not a project member | Rare | Very high — cross-tenant probe | Yes, `warn` |
| No access to private project | Rare | Very high | Yes, `warn` |
| `Forbidden` (role too low) | Low | Medium | Yes, `info` |
| Project not found | Moderate | Low | **No** |
| Project is closed, caller IS a member | Moderate | None — normal navigation | **No** |
| Project is closed, caller is NOT a member | Rare | Very high — same cross-tenant probe | Yes, `authz.denied_not_member` |
| Unauthorized (no session) | Very high | None — expired sessions | **No** |

Uniform sampling drops precisely the events worth having: a 1-in-10 sample of a population
dominated by expired sessions reliably captures expired sessions and reliably misses the
single cross-tenant probe. Not emitting the zero-signal denials removes the volume problem
that sampling exists to solve. `authz-denial-events.test.ts` pins the **silence** as well as
the emissions — deleting a "no event here" case is a visible test change, not a quiet drift.

**Thresholding stays out of the emitter and belongs in SECH-117.** It is policy ("alert when
one actor trips 20 of these in 5 minutes"), it should be tunable without a deploy, and
per-actor counters held in the emitter would be per-instance — and therefore wrong — on a
platform that restarts and scales processes freely.

That policy now lives in `src/lib/alerting/rules.ts` (`authz_probe`) — see `alerting.md`.

## The `emit()` seam

`securityEvent()` builds the record and hands it to one private `emit()`. That is where
SECH-115 redacts `meta` here; SECH-117's `notifyAlerting()` runs after the log line is written
(see `alerting.md`) — one file, not 150 call sites.

`emit()` **degrades rather than throwing.** `JSON.stringify` throws on a circular structure
or a `BigInt`, and passing a Prisma object into `meta` is a realistic mistake; an exception
inside the emitter during a failed login would turn a 401 into a 500. On failure it emits the
same record with `meta: { serializationFailed: true }`. A logger must never be the reason a
request dies.

## Request / correlation IDs

`src/lib/request-id.ts` is deliberately dependency-free because `src/middleware.ts` runs on
the **Edge runtime**: use the global `crypto.randomUUID()`, never `import … from "node:crypto"`.

Middleware validates an inbound `x-request-id` against a strict UUID pattern and regenerates
anything malformed — the value lands in a log stream, so an unvalidated header is a
log-injection vector (a CRLF would forge a second, attacker-authored event line). The ID is
set on the forwarded request headers **and on every response**, which is how "include it in
error responses" is satisfied without touching a single route handler.

**The `/api/auth` gap.** The middleware matcher excludes `api/auth`, and login failures are
emitted from the `authorize` callback reached via `/api/auth/callback/credentials` — so the
highest-value event source is the one path middleware never runs on. Widening the matcher over
a live auth path was rejected (the blast radius of a middleware bug there is total lockout).
Server Actions and route handlers read the id with `currentRequestId()` from
`src/lib/request-context.ts` (`await headers()`, returning `undefined` outside a request
scope). That module is separate from `request-id.ts` precisely because `next/headers` is not
available on Edge, and `request-id.ts` must stay import-free for middleware.

Instead `securityEvent()` **lazily generates an ID when none is supplied**. Every event carries
one; middleware's job is making a single ID span *multiple* events in one request.

## Production behaviour (verified 2026-09-24)

Confirmed against Railway on commit `cd08a452`, by sending requests with **no** inbound
`x-request-id` and matching the response header against the emitted event:

- The route handler receives middleware's rewritten header. `NextResponse.next({ request: {
  headers } })` propagates into API route handlers in a production build behind Railway's
  proxy — worth recording because no other API route in this codebase reads a
  middleware-injected header, so there was no prior art for it. Locally the same thing is
  provable with a malformed or absent inbound id: if forwarding failed, `securityEvent()`
  would fall back to a lazily generated id that would NOT match the response header.
- **Railway parses the single-line JSON into structured fields** rather than storing it as a
  blob: `evt`, `ts`, `type`, `severity`, `requestId`, `ip` and `meta.*` each render as
  attributes in Deploy Logs. SECH-117 can therefore query on `type`/`severity` as fields
  instead of regex-matching text — design alert rules on that assumption.
- The `ip` field resolves to a real client IP, so the SECH-108 leftmost-XFF derivation still
  holds for events as well as rate limiting.

Reading these logs: see `.context-docs/local-dev-tooling.md` → the Railway dashboard bullet.
Notably, the Deploy Logs **filter box does not substring-match history**, so an empty filtered
result is not evidence the event is missing.

## Adding an event type

1. Add it to the `SecurityEventType` union **and** `SECURITY_EVENT_SEVERITY` (the record type
   makes a missing severity a compile error).
2. Add it to the pinned list in `src/lib/__tests__/security-events.test.ts`.
3. Wire a real call site, and add a row to `WIRING` in
   `src/__tests__/security-event-wiring.test.ts`.

Step 3 is not optional: `security-event-wiring.test.ts` has a coverage assertion that fails if
a catalog type is never emitted. A declared-but-unwired type produces an SECH-117 alert rule
that can never fire, and the resulting silence reads as "no attacks".

## Guard tests

| Test | What breaks it |
|---|---|
| `lib/__tests__/security-events.test.ts` | record shape, meta collision, newline splitting, unserializable meta, catalog/severity drift |
| `lib/__tests__/request-id.test.ts` | malformed inbound IDs being honoured |
| `__tests__/request-id-middleware.test.ts` | middleware not wiring the helpers, or a bare `return NextResponse.` skipping the header |
| `__tests__/security-logging-sinks.test.ts` | ad-hoc `[security]`/`[csp-report]` logging returning, or anything but the emitter writing a security record |
| `__tests__/security-event-wiring.test.ts` | a catalog type with no call site; a secret in an OAuth or API-key event |
| `__tests__/authz-denial-events.test.ts` | a zero-signal denial starting to emit, or a boundary denial going silent |

## Privacy

No token, secret, presigned URL, password or file content reaches `meta` from any call site.
Two deliberate decisions:

- **The login-failure event carries `email`**, exactly as `logAuthFailure` did before. Without
  it, credential stuffing is indistinguishable from one person mistyping their password. This
  is flagged for **SECH-115** to decide deliberately rather than changed quietly here.
- **`admin.action` carries only ids** — actor as `userId`, and the affected account as
  `targetUserId` when the target is a User. Never name or email: the `AdminAuditLog` row
  already holds those for the admin UI, and a log destination should not become a second PII
  sink.

`csp-report`'s `scrub()` strips the query string from `document-uri`/`blocked-uri` **and**
redacts token-bearing path prefixes. Stripping the query alone was not enough: an invite token
lives in the path (`/invite/<token>`), so a CSP violation raised on an invite page wrote a live,
unused token to the stream. New token-bearing routes must be added to `TOKEN_PATH_PREFIXES`.
