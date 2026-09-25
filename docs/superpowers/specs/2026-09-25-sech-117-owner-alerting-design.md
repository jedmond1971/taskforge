# SECH-117 — Owner alerting for high-confidence security events and outages

Date: 2026-09-25
Ticket: SECH-117 (Plan ref SH-030 task 5, plus the gate item "test alerts reach the owner").
Parent epic: SECH-100. Depends on SECH-114 (`securityEvent`, the `emit()` seam) and SECH-115
(redaction — alerting sees post-redaction `meta`).
Status: design approved in conversation, awaiting written-spec review.

## Problem

`securityEvent()` writes one JSON line per event to stdout, where Railway parses it into fields.
Nothing reads those events programmatically, so an attack in progress is only noticed if Jamie
happens to be reading Deploy Logs. `security-events.md` deferred thresholding to this ticket
("policy, tunable, and per-actor counters in the emitter would be per-instance and therefore
wrong"). This ticket delivers that policy plus a delivery path Jamie reliably receives.

## Decisions taken (with the alternatives that lost)

- **Evaluate in the app, inline on emit** (chosen over shipping logs to an external platform, and
  over waiting for the SECH-116 error tracker). No new vendor, reuses Resend and the
  Postgres-backed-counter pattern, and rules are testable in-repo. The catch — the app cannot
  report its own outage — is covered by an external uptime monitor.
- **Inline (fire-and-forget) rather than outbox + cron.** A GitHub Actions cron is best-effort
  and can run 5–15 minutes late; refresh-token reuse and revoked-key use are the alerts where
  minutes matter. Cost: an alert can be lost if the process dies mid-send. Accepted — the event
  is still in the logs.
- **Thresholds are constants in code**, reviewed through a PR, not env-tunable.
  `security-events.md` said "tunable without a deploy"; a Railway env change restarts the
  service anyway, so an env override saves almost nothing and loses test coverage.

## Non-goals

- Error tracking (SECH-116), kill switches (SECH-118), runbooks (SECH-119).
- Paging, SMS, Slack or any second channel. Email only.
- Org-level `OWNER`/`ADMIN` grants (only platform `UserRole.ADMIN`; org grants are more frequent
  and a separate policy decision).
- A per-org alert configuration UI. One owner, one address.

## Architecture

```
securityEvent() → emit() ─┬─ console.warn(line)            (unchanged, first, always)
                          └─ alerting.observe(record)      (detached; never throws, never awaited)
                                 │  type not in any rule → return (no DB touch)
                                 ▼
                          record observation ─▶ evaluate rule ─▶ claim cooldown ─▶ cap check ─▶ Resend
                          (AlertEvent)          (count/distinct)  (AlertState)     (AlertEvent)
```

- `emit()` keeps writing the log line first and unchanged. `observe()` is called after, wrapped in
  a detached promise with a catch, so a failure in alerting cannot alter the log line or turn a
  request into a 500. A test pins that `emit()` output is byte-identical whether `observe()`
  resolves, rejects or throws.
- **Alerting uses its own Prisma client**, never the shared one: the shared client's `$on("error")`
  emits `prisma.error`, which feeds `error_spike`, so a failed alerting query would re-enter alerting
  (added after the Phase 1 review). `observe()` is also bounded to 20 concurrent calls.
- **Alerting never calls `securityEvent`/`logError`.** `app.error` and `prisma.error` feed the
  `error_spike` rule; an alerting failure that emitted one would feed itself. Its own failures
  write one plain stderr line via a single `console` call that is added to the
  `console-sinks.test.ts` allowlist with a reason. A guard test fails if any module under
  `src/lib/alerting/` imports `security-events`.
- Only event types that appear in a rule touch the database. `csp.violation`,
  `admin.action` and the other info-level types cost nothing.
- Runs in the Node runtime only. `emit()` is never reached from Edge middleware.

### Files (proposed)

| File | Responsibility |
|---|---|
| `src/lib/alerting/rules.ts` | The rule table (data only). No I/O. |
| `src/lib/alerting/evaluate.ts` | Pure: given rule + observations → tripped or not. |
| `src/lib/alerting/store.ts` | The only Prisma access: record, count, claim cooldown, cap, prune. |
| `src/lib/alerting/deliver.ts` | Builds the email, sends via Resend. Lazy client (see `email.md`). |
| `src/lib/alerting/index.ts` | `observe()` and `runDrill()`; wires the above; owns config/disable logic. |
| `src/emails/SecurityAlertEmail.tsx` | React Email template; rendered to `html` before send. |

## Data model (migration `<ts>_alerting`)

```prisma
model AlertEvent {
  id        String   @id @default(cuid())
  rule      String            // rule id, or "_sent" for the global-cap ledger
  subject   String            // what the rule groups by: ip / userId / apiKeyId / "global"
  detail    String?           // distinct-count discriminator (login_spray: hash of the account)
  createdAt DateTime @default(now())
  @@index([rule, subject, createdAt])
}

model AlertState {
  rule            String
  subject         String
  lastSentAt      DateTime
  suppressedCount Int      @default(0)
  @@id([rule, subject])
}
```

- **Both tables live in Postgres**, so counts and cooldowns are shared across instances and
  survive restarts (same reasoning as `RateLimitAttempt`).
- `detail` for `login_spray` is `sha256(lowercased meta.emailAttempted).slice(0, 16)`. The raw
  address is never stored in these tables or placed in an email. (`emailAttempted` survives
  SECH-115 redaction because it is deliberately not in the sensitive-key list; the hash is taken
  from the post-redaction record.) A 16-hex prefix of an email hash is dictionary-recoverable,
  which is acceptable for a 24-hour operational table that is never exported.
- Immediate ("every occurrence") rules write **no** `AlertEvent` row — they go straight to the
  cooldown claim.
- Pruning: on about 1% of writes, delete `AlertEvent` older than 24 h and `AlertState` older
  than 7 d (mirrors the limiter's housekeeping).

## Rules

All windows are rolling. Constants live in `rules.ts`.

| Rule id | Source event types | Subject | Fires when | Cooldown |
|---|---|---|---|---|
| `login_spray` | `auth.login_failed`, `auth.login_throttled` | `ip` | ≥ 10 **distinct accounts** in 10 min | 1 h per IP |
| `refresh_reuse` | `oauth.refresh_reuse_detected` | `userId` | every occurrence | 1 h per user |
| `revoked_key_used` | `apikey.used_after_revoke` | `meta.apiKeyId` | every occurrence | 1 h per key |
| `admin_role_granted` | `admin.role_granted` (new) | `targetUserId` | every occurrence | none |
| `authz_probe` | `authz.denied_not_member`, `authz.denied_private_project`, `authz.denied_not_org_member`, `authz.denied_admin` | `userId` | ≥ 10 in 10 min | 1 h per user |
| `error_spike` | `app.error`, `prisma.error` | `"global"` | ≥ 20 in 5 min | 30 min |
| Site down | *not in the app* | — | external monitor on `https://www.jedforge.com/login` | — |

Rationale worth keeping:

- **`login_spray` counts failures, not only throttles.** Credential stuffing tries one password
  per account, so it never reaches the 5-failure per-ip+email throttle (or the 20 per-account
  one). "A throttle burst across many accounts" is better detected as many distinct accounts
  failing from one IP. Shared-NAT false positives need ≥ 10 different accounts failing in 10
  minutes from one address, which is not normal office behaviour.
- **`authz_probe` excludes `authz.denied_role`** (info): the medium-signal, low-volume denial
  `security-events.md` deliberately keeps out of alerting. The four included types are the
  warn-level ones; a rule matching a zero-signal denial would be noise.
- A subject missing from an event (for example an `authz.denied_*` with no `userId`) cannot be
  grouped; such an observation is dropped rather than bucketed under `undefined`. The plan must
  verify each source call site sets the subject field the rule groups by.

## New event: `admin.role_granted`

Severity `critical`. Emitted when a platform `UserRole.ADMIN` is granted:

- `adminCreateUser` when `data.role === "ADMIN"` (`admin/actions.ts`).
- `adminUpdateUser` when `roleChanged` and the new role is `ADMIN`.

`userId` = the acting admin, `targetUserId` = the grantee, `meta: { from?, to: "ADMIN", trigger }`.
No name or email (same rule as `admin.action`). Follows the "Adding an event type" checklist in
`security-events.md`: union, `SECURITY_EVENT_SEVERITY`, the pinned list, a `WIRING` row.

## Flood control

1. **Per-rule, per-subject cooldown.** A single atomic statement claims the send:
   `INSERT … ON CONFLICT (rule, subject) DO UPDATE SET lastSentAt = now(), suppressedCount = 0
   WHERE "AlertState"."lastSentAt" < now() - <cooldown>`, and must yield the **previous**
   `suppressedCount` so the winning email can say "+N since last alert". The losing path
   increments `suppressedCount`. Two instances cannot both send.
2. **Global cap: 10 alert emails per hour** (counted from `AlertEvent` rows with rule `_sent`).
   The cap is soft — two instances can overshoot by one — which is acceptable for a flood guard.
   Past the cap, one "alert cap reached" email is sent (itself a cooldown-claimed `_cap` state,
   1 h) and further alerts are only logged to stderr.
3. Drill traffic (below) is exempt from the cap and never touches real subjects.
4. **Critical rules are exempt from the global cap** (added after the Phase 1 review): their
   per-subject cooldowns already bound them, and warn-level noise must not be able to silence a
   critical alert for an hour. Capped warn alerts are logged (once per rule per process).
5. **A subject already in cooldown costs one statement** (a suppressed-count increment), and
   failed sends are retried inline (2 s, 10 s) before the claim is backdated — a one-off critical
   alert has no later event to retry it.

## Delivery

- Resend, from `JedForge Alerts <alerts@jedforge.com>` (sending domain already verified; the
  mailbox need not exist — `email.md`), to `ALERT_EMAIL_TO`. The address is an env var only, never
  in code, the repo, or logs.
- Body: rule name, severity, window and count, subject (ip / user id / key id), suppressed count,
  first/last timestamp, `requestId`(s), and a pointer to Railway Deploy Logs filtered on
  `type`. **Never** an email address, token, key material or `meta` blob. A test feeds sensitive
  fixtures and asserts none appear in the rendered html.
- Template rendered with `render()` to `html` before `emails.send` (`email.md` gotcha). Resend
  client instantiated inside the send function.

## Configuration and disabled behaviour

| Var | Meaning |
|---|---|
| `ALERTING_ENABLED` | `true` to enable. Unset = off (kill switch; also the merge-dormant default). |
| `ALERT_EMAIL_TO` | Recipient. Required when enabled. |
| `RESEND_API_KEY` | Already present for invites. |
| `ALERT_EMAIL_FROM` | Optional override of the default From. |

If enabled but `ALERT_EMAIL_TO`/`RESEND_API_KEY` is missing, alerting turns itself off with one
stderr warning and the app is unaffected. **Silent-off must not pass as "quiet"**: the drill
reports `configured: true|false` and which variable is missing.

## Failure handling

- **DB unreachable:** the alert is dropped, one stderr line, request unaffected.
- **Resend error:** the cooldown claim is backdated (`lastSentAt = now() - cooldown + 5 min`) so
  the next matching event can retry after 5 minutes rather than being silenced for the full
  window.
- **Serialization or template failure:** caught in `observe()`; same stderr line.
- `observe()` never rejects to its caller.

## Delivery drill (proves the path; substitutes for staging)

An admin-only server action `sendAlertDrill()` (`requireAdmin()`), surfaced as a "Send test
alerts" control in the admin area (exact page chosen in the plan):

- For each in-app rule it injects synthetic observations (threshold-many, subject
  `drill:<runId>`) and runs the **real** evaluate → claim → render → Resend path, so counting,
  cooldown and delivery are all exercised. Synthetic rows are deleted afterwards.
- Emails are subject-prefixed `[DRILL]`; drill traffic is cap-exempt.
- Returns per-rule `{ rule, sent, error? }` plus the `configured` status.
- Itself rate-limited: one drill per 10 minutes via a new `LIMITS` entry (attempts mode).
- Needs a row in `.context-docs/authz-matrix.md`, an entry in `everyAdminAction()`
  (`src/integration/admin-actions.itest.ts`), and an integration test with Resend mocked.
- The site-down alert is proven by the uptime monitor's own "send test notification".

## Testing

**Unit:** rule evaluator at N−1 / N, window expiry, distinct counting, subject isolation; email
builder leaks nothing sensitive; `emit()` output identical when `observe()` throws or rejects.

**Integration (real DB, Resend mocked):** two concurrent claims → exactly one send;
`suppressedCount` carried into the next email; the cap sends 10 then one "cap reached" email;
drill exempt from the cap; failed-send backdating allows a retry after 5 min; disabled/misconfigured
sends nothing and reports it.

**Guard tests:**
- Every catalog type with severity `critical` is covered by a rule **or** on a documented
  exception list in the test. A new critical event with no alert fails the build rather than
  going quiet.
- Every rule's source types exist in the catalog (and are wired — the existing wiring test covers
  emission).
- No module under `src/lib/alerting/` imports `security-events` (loop guard).
- The alerting stderr write is on the `console-sinks` allowlist with its reason.
- `authz-matrix` row, `everyAdminAction()` entry and `LIMITS` entry for the drill exist.

## Rollout

1. **Two PRs**, as with 114/115:
   - **Phase 1:** migration, engine, rules, delivery, `admin.role_granted`, tests,
     `.context-docs/alerting.md`, `.env.example`, updates to `security-events.md` (the "SECH-117
     adds a sink" seam text) and the CLAUDE.md reference list.
   - **Phase 2:** the drill action, its UI, tests, authz-matrix and admin-action entries.
2. **Dormant on merge** (`ALERTING_ENABLED` unset). After each deploy, confirm the migration
   applied via the `deployments(...)` query (`meta.commitHash` matches, `status: SUCCESS`).
3. Jamie sets `ALERT_EMAIL_TO` and `ALERTING_ENABLED=true` in Railway, then runs the drill in
   production. The global cap bounds the damage of a bad threshold.
4. **Jamie's manual step:** create an external uptime check (UptimeRobot or Better Stack, free
   tier) on `https://www.jedforge.com/login` alerting to his email, and use its "send test
   notification". This is the only piece that covers a full outage.
5. Evidence (timestamps + inbox screenshot per alert type) is attached to SECH-117 as a Maximus
   comment via the production v1 API, not the MCP connector.

### Deviation from the ticket's definition of done

The ticket says "triggered in staging". SECH-110 (staging) is not provisioned. The drill is run
in production, clearly labelled `[DRILL]`, and SECH-117 gets a note that it should be re-run
once staging exists. Jamie to accept this on review of the spec.

## Open items for the plan (not design questions)

- Verify each source call site sets the subject field its rule groups by
  (`authz.denied_*` → `userId`; `auth.login_*` → `ip` + `meta.emailAttempted`).
- Choose the concrete SQL/CTE for the claim that returns the prior `suppressedCount`.
- Choose the admin-area location for the drill control.
- Decide whether `ALERT_EMAIL_FROM` is worth keeping or is YAGNI.
