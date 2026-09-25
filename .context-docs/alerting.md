# Owner alerting (SECH-117)

Emails the owner when a high-confidence security event or an error spike happens. **Off by
default**: nothing runs unless `ALERTING_ENABLED` is exactly `"true"`.

## How it works

```
securityEvent() → emit() ─┬─ console.warn(line)            (unchanged, first, always)
                          └─ notifyAlerting(record)        (detached; never awaited, never throws)
                                 │  alerting off, or type not in any rule → return (no DB, no import)
                                 ▼  import("./alerting") — lazy, see below
                          observe(record) → record observation → count → claim cooldown → cap check → Resend
                                            (AlertEvent)                 (AlertState)    (AlertEvent "_sent")
```

- **The import is lazy on purpose.** Alerting reaches Prisma, and `prisma.ts` imports
  `security-events.ts`, so a static import would be a cycle. Only `rules.ts` and `config.ts` are
  loaded statically, and both are import-free (a guard test enforces it). A deployment with
  alerting off never loads Resend or the store.
- **`observe()` never rejects.** Any failure inside alerting ends in `alertingFailure()` (a plain
  `console.warn("[alerting]", kind, text)`), never in a request.
- Immediate ("every occurrence") rules write no `AlertEvent` row — they go straight to the
  cooldown claim. Threshold rules record an observation, count it in the window, and only then
  claim.

## Rules (`src/lib/alerting/rules.ts`)

| Rule id | Source events | Subject | Fires when | Cooldown |
|---|---|---|---|---|
| `login_spray` | `auth.login_failed`, `auth.login_throttled` | `ip` | ≥ 10 **distinct accounts** in 10 min | 1 h per IP |
| `refresh_reuse` | `oauth.refresh_reuse_detected` | `userId` | every occurrence | 1 h per user |
| `revoked_key_used` | `apikey.used_after_revoke` | `meta.apiKeyId` | every occurrence | 1 h per key |
| `admin_role_granted` | `admin.role_granted` | `targetUserId` | every occurrence | none |
| `authz_probe` | `authz.denied_not_member`, `_private_project`, `_not_org_member`, `authz.denied_admin` | acting `userId` | ≥ 10 in 10 min | 1 h per user |
| `error_spike` | `app.error`, `prisma.error` | `"global"` | ≥ 20 in 5 min | 30 min |
| Site down | — (not in the app) | — | external uptime monitor on `https://www.jedforge.com/login` | — |

- **`login_spray` counts failures, not only throttles.** Credential stuffing tries one password
  per account, so it never reaches the 5-failure per-ip+email throttle. Accounts are counted by
  `sha256(lowercased email).slice(0, 16)`; the raw address is never stored or emailed. An event
  with `ip: "unknown"` or no `emailAttempted` is dropped rather than pooled into one bucket.
- **`authz_probe` excludes `authz.denied_role`** — the low-volume, medium-signal info denial
  `security-events.md` deliberately keeps out of alerting.
- Thresholds are constants in code, reviewed through a PR. A Railway env change restarts the
  service anyway, so an env override would save almost nothing and lose test coverage.

## Tables

- `AlertEvent(id, rule, subject, detail?, createdAt)` — observations that threshold rules count,
  plus the `_sent` ledger rows the global cap reads. Pruned after 24 h on ~1% of writes.
- `AlertState(rule, subject, lastSentAt, suppressedCount)` — the cooldown. Pruned after 7 d.

## Flood control

1. **Cooldown claim** (`store.claimSend`): a single `INSERT … ON CONFLICT … DO UPDATE … WHERE
   lastSentAt < now() - cooldown` statement using the database clock, so two instances cannot both
   send. It also returns the **prior** `suppressedCount` so the winning email says "N since last
   alert". A losing claim increments the count.
2. **Global cap: 10 emails per hour.** The cap is soft (two instances can overshoot by one). Past
   it, one "Alert cap reached" email is sent (itself cooldown-claimed for 1 h), then alerts are
   only logged. Cap notices do not count toward the cap.
3. **Failed send:** the claim is backdated so a matching event can retry after 5 minutes rather
   than being silenced for the full cooldown, and the failed send is not counted toward the cap.

## Configuration

| Var | Meaning |
|---|---|
| `ALERTING_ENABLED` | Exactly `"true"` to enable. Unset = off (also the kill switch). |
| `ALERT_EMAIL_TO` | Recipient. Required when enabled. Never commit a real address. |
| `RESEND_API_KEY` | Already present for invites. |

From address is the constant `JedForge Alerts <alerts@jedforge.com>` (`config.ts`). Enabled but
missing a variable: alerting stays off, writes one `[alerting] misconfigured` warning, and the app
is unaffected — so **absence of alerts is not proof of a quiet week** until the drill (below) has
reported `configured: true`.

## Never

- Never call `securityEvent`/`logError` from `src/lib/alerting/`. `app.error` and `prisma.error`
  feed `error_spike`, so an alerting failure that emitted one would feed itself.
  `alerting-guards.test.ts` fails on an import of `security-events`.
- Never import Prisma outside `store.ts`, and keep `rules.ts` / `config.ts` import-free.
- Never put an email address, token or key material in a rule `subject` or in the email body.

## Adding a rule

1. Add it to `ALERT_RULES`. Make sure the source call site actually sets the field the rule groups
   by (verify it — a missing subject means the observation is silently dropped).
2. `alerting-guards.test.ts` fails on an unknown source type, and on any `critical` catalog type
   that has no rule and no reasoned entry in `UNALERTED_CRITICAL`.
3. Add cases to `src/lib/__tests__/alerting-rules.test.ts` and a flow case to
   `src/integration/alerting-flow.itest.ts`.

## Site down

The app cannot report its own outage. An external monitor (UptimeRobot or Better Stack, free tier)
checks `https://www.jedforge.com/login` and emails the owner directly. Set up manually.

## Delivery drill

Added in Phase 2 — see this section once that PR lands.

## Tests

| Test | Covers |
|---|---|
| `lib/__tests__/alerting-rules.test.ts`, `alerting-config.test.ts` | subjects, thresholds, hashing, config |
| `lib/__tests__/alerting-deliver.test.ts` | email content, provider errors |
| `lib/__tests__/security-events-alerting.test.ts` | the `emit()` hook is inert to alerting failures |
| `integration/alerting-store.itest.ts` | atomic claim (12-way race), window, distinct, prune |
| `integration/alerting-flow.itest.ts` | end-to-end rules, cooldown, cap, retry, no address leak, disabled |
| `__tests__/alerting-guards.test.ts` | catalog coverage, loop guard, import-free modules |
