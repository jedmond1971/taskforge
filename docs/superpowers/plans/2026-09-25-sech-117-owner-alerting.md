# SECH-117 Owner Alerting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email the owner within seconds when a high-confidence security event or error spike occurs, with Postgres-backed thresholds, cooldowns and a global cap, and prove delivery with an admin-triggered drill.

**Architecture:** `emit()` in `src/lib/security-events.ts` keeps writing the log line, then hands the record to `alerting.observe()` as a detached, never-throwing promise (lazy `import()` because `prisma.ts` imports `security-events.ts`). Rules are data (`rules.ts`); counting and the atomic cooldown claim live in Postgres (`AlertEvent`, `AlertState`); delivery is Resend. A separate admin-only drill drives the real path with synthetic observations.

**Tech Stack:** Next.js 16, Prisma 5 + Postgres, Resend + React Email, Vitest (hermetic `npm test` + DB-backed `npm run test:integration`).

**Spec:** `docs/superpowers/specs/2026-09-25-sech-117-owner-alerting-design.md` (committed on branch `sech-117-owner-alerting`). Read it first; this plan resolves its four "open items" (see Decisions below).

## Decisions resolving the spec's open items

- **Subjects verified against call sites:** `authz.denied_*` set `userId` ✔; `auth.login_*` set `ip` + `meta.emailAttempted` (no `userId`) ✔; `oauth.refresh_reuse_detected` sets `userId` ✔; `apikey.used_after_revoke` sets `meta.apiKeyId` (no `userId`) ✔.
- **Claim SQL:** one CTE statement using the DB clock (`now()`), returning the prior `suppressedCount` (Task 4).
- **Drill control location:** new admin page `/admin/alerting` + a card on `/admin`. The action lives in `admin/actions.ts` so the existing `everyAdminAction()` coverage test and the authz-matrix section apply automatically.
- **`ALERT_EMAIL_FROM` dropped (YAGNI):** the From address is a constant.
- **`evaluate.ts` stays** (pure matching + hashing), but `rules.ts` and `config.ts` are import-free so `security-events.ts` can load them statically on every emit.

## Global Constraints

- Thresholds/cooldowns exactly as the spec: `login_spray` ≥10 distinct accounts/10 min, 1 h per IP; `refresh_reuse` every occurrence, 1 h per user; `revoked_key_used` every occurrence, 1 h per key; `admin_role_granted` every occurrence, no cooldown; `authz_probe` ≥10/10 min, 1 h per user; `error_spike` ≥20/5 min global, 30 min.
- Global cap: 10 alert emails per hour; failed send backdates the claim so a retry is possible after 5 minutes.
- Env vars: `ALERTING_ENABLED` (must equal `"true"`; unset = off), `ALERT_EMAIL_TO`, `RESEND_API_KEY`. From: `JedForge Alerts <alerts@jedforge.com>`.
- Alerting **never** calls `securityEvent`/`logError` and no file under `src/lib/alerting/` imports `security-events`.
- No raw email address, token, key material or `meta` blob in any alert table or email. Accounts are counted by `sha256(lowercased email).slice(0, 16)`.
- Resend client is instantiated **inside** the send function, and the template is `render()`ed to `html` before `emails.send` (`.context-docs/email.md`).
- `main` is protected: branch → PR → required checks → `gh pr merge --squash --delete-branch`. Never push to `main`.
- Pre-commit: `npm run lint` (0 errors, no new warnings), `npx tsc --noEmit`, `npm test`, `git diff --name-only --cached`. This change touches admin actions and server code, so also `npm run test:integration` before each PR (needs the local Docker DB).
- Use `Array.from(new Set(...))`, never `[...new Set()]` (TS2802).
- Every commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (pass it as a second `-m`). PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Post the fix-summary comment on SECH-117 as Maximus (`authorId: "cmo365psl000vdrd0p63lirlz"`) through the **production v1 REST API** with Python `urllib` (heredoc), never the MCP connector.

## Review Focus

Inputs the spec implies but the obvious tests would miss, most likely first. Each has a pinning test in the task named.

1. **`observe()` throws, rejects or the dynamic import fails** — the request and the emitted log line must be unaffected, with no unhandled rejection (Task 7).
2. **A login event with `ip: "unknown"` or no `emailAttempted`** — dropped, never bucketed into one shared subject that trips `login_spray` for everyone (Task 3).
3. **Two instances racing on one cooldown** — exactly one email (Tasks 4 and 6).
4. **Resend returns an error** — the rule is not silenced for the full cooldown, and the failed send does not count toward the global cap (Task 6).
5. **A victim's email address in `meta.emailAttempted`** — must not appear in `AlertEvent` rows or the outgoing HTML (Tasks 3 and 6).
6. *(Covered by the drill, Task 9)* alerting enabled but `ALERT_EMAIL_TO`/`RESEND_API_KEY` missing must report itself rather than look like a quiet week.

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `src/lib/security-events.ts` | 1, 7 | + `admin.role_granted` type/severity; + `notifyAlerting()` hook in `emit()` |
| `src/app/(dashboard)/admin/actions.ts` | 1, 9 | emit `admin.role_granted` (2 sites); + `adminSendAlertDrill` |
| `prisma/schema.prisma`, `prisma/migrations/20260925000000_add_alerting/migration.sql` | 2 | `AlertEvent`, `AlertState` |
| `src/lib/alerting/config.ts` | 3 | env → `AlertConfig`; **no imports** |
| `src/lib/alerting/rules.ts` | 3 | rule table + `ALERT_SOURCE_TYPES`; **no imports** |
| `src/lib/alerting/evaluate.ts` | 3 | pure `observationsFor`, `isTripped`, `hashDetail` |
| `src/lib/alerting/store.ts` | 4, 9 | only Prisma access: record/count/claim/backdate/ledger/prune/drill cleanup |
| `src/emails/SecurityAlertEmail.tsx` | 5 | React Email template |
| `src/lib/alerting/deliver.ts` | 5 | `AlertMessage`, `sendAlertEmail()` |
| `src/lib/alerting/log.ts` | 6 | the subsystem's own failure line (plain `console.warn`) |
| `src/lib/alerting/index.ts` | 6, 9 | `observe()`, `dispatch()`, `runDrill()` |
| `src/lib/rate-limit.ts` | 9 | `LIMITS.alertDrillPerUser` |
| `src/app/(dashboard)/admin/alerting/{page,AlertDrillClient}.tsx` | 10 | drill UI |
| Tests | per task | `src/lib/__tests__/alerting-*.test.ts`, `src/__tests__/alerting-guards.test.ts`, `src/integration/{admin-role-granted,alerting-store,alerting-flow,alerting-drill}.itest.ts` |
| Docs | 8, 11 | `.context-docs/alerting.md`, `security-events.md`, `rate-limiting.md`, `authz-matrix.md`, `CLAUDE.md`, `.env.example` |

---

# PHASE 1 — engine, rules, delivery (PR 1, branch `sech-117-owner-alerting`)

### Task 1: The `admin.role_granted` event

**Files:**
- Modify: `src/lib/security-events.ts` (type union ~line 38, severity map ~line 66)
- Modify: `src/app/(dashboard)/admin/actions.ts` (`adminCreateUser` ~line 60, `adminUpdateUser` ~line 105)
- Modify: `src/lib/__tests__/security-events.test.ts:174` (pinned list)
- Modify: `src/__tests__/security-event-wiring.test.ts` (`WIRING`)
- Create: `src/integration/admin-role-granted.itest.ts`

**Interfaces:**
- Produces: `SecurityEventType` member `"admin.role_granted"`, severity `"critical"`. Emitted with `userId` = acting admin, `targetUserId` = grantee, `meta: { from?, to: "ADMIN", trigger }`. Task 3's `admin_role_granted` rule groups on `targetUserId`.

- [ ] **Step 0: Pre-flight (CLAUDE.md startup checklist)**

```bash
cd /home/jamie/Projects/TaskForge
git branch --show-current            # expect: sech-117-owner-alerting
git status --short                   # only the known mode-only vitest.config.ts + untracked strays
docker start taskforge-db 2>/dev/null; docker ps --filter name=taskforge-db --format "{{.Status}}"
```
If the docker line prints nothing, follow the recreate-and-reseed recipe in `.context-docs/local-dev-tooling.md` before continuing.

Then move SECH-117 to In Progress (production v1 API, key from local `.env`, never printed):

```bash
python3 - << 'PYEOF'
import json, urllib.request
key = next(l.split('=',1)[1].strip().strip('"\'') for l in open('.env') if l.startswith('V1_API_KEY='))
base = 'https://taskforge-production-099b.up.railway.app/api/v1'
req = urllib.request.Request(base + '/issues/SECH-117', method='PATCH',
    data=json.dumps({'statusId': 'In Progress'}).encode(),
    headers={'X-Internal-Api-Key': key, 'Content-Type': 'application/json'})
print(json.load(urllib.request.urlopen(req)).get('status'))
PYEOF
```

- [ ] **Step 1: Write the failing integration test**

Create `src/integration/admin-role-granted.itest.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs } from "./session";
import * as adminActions from "@/app/(dashboard)/admin/actions";

/**
 * SECH-117: granting the platform ADMIN role is a critical event. Before this, a grant only
 * appeared as the generic admin.action, so no alert rule could match it specifically.
 */

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => { await destroyWorld(w); });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

function events(type: string): Array<Record<string, unknown>> {
  return warn.mock.calls
    .map(([line]) => { try { return JSON.parse(String(line)); } catch { return null; } })
    .filter((r): r is Record<string, unknown> => !!r && r.evt === "security" && r.type === type);
}

describe("admin.role_granted", () => {
  it("adminUpdateUser to ADMIN emits it with the actor and the grantee kept apart", async () => {
    actAs(w.users.aAdmin);
    const prior = (await prisma.user.findUnique({ where: { id: w.users.aMember.id }, select: { role: true } }))!.role;
    try {
      expect(await adminActions.adminUpdateUser(w.users.aMember.id, { role: "ADMIN" })).toMatchObject({ success: true });
      const [evt] = events("admin.role_granted");
      expect(evt).toMatchObject({
        severity: "critical",
        userId: w.users.aAdmin.id,
        targetUserId: w.users.aMember.id,
        meta: { from: prior, to: "ADMIN", trigger: "admin_update_user" },
      });
      expect(events("admin.role_granted")).toHaveLength(1);
    } finally {
      await prisma.user.update({ where: { id: w.users.aMember.id }, data: { role: prior } });
    }
  });

  it("emits nothing when the role does not change or is not ADMIN", async () => {
    actAs(w.users.aAdmin);
    await adminActions.adminUpdateUser(w.users.aAdmin.id, { role: "ADMIN" }); // already ADMIN
    await adminActions.adminUpdateUser(w.users.aMember.id, { name: "Renamed" }); // no role in update
    expect(events("admin.role_granted")).toHaveLength(0);
  });

  it("adminCreateUser emits it only when the new user is an ADMIN", async () => {
    actAs(w.users.aAdmin);
    const adminEmail = `${w.tag}-newadmin@itest.local`;
    const plainEmail = `${w.tag}-newplain@itest.local`;
    try {
      await adminActions.adminCreateUser({ name: "x", email: plainEmail, password: "password123", role: "TEAM_MEMBER" });
      expect(events("admin.role_granted")).toHaveLength(0);

      await adminActions.adminCreateUser({ name: "x", email: adminEmail, password: "password123", role: "ADMIN" });
      const created = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } });
      const [evt] = events("admin.role_granted");
      expect(evt).toMatchObject({
        userId: w.users.aAdmin.id,
        targetUserId: created!.id,
        meta: { to: "ADMIN", trigger: "admin_create_user" },
      });
    } finally {
      await prisma.user.deleteMany({ where: { email: { in: [adminEmail, plainEmail] } } });
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration -- src/integration/admin-role-granted.itest.ts`
Expected: FAIL — `events("admin.role_granted")` is empty (and TS complains the type does not exist once you add the pinned entry in Step 4).

- [ ] **Step 3: Add the type and severity**

In `src/lib/security-events.ts`, add `| "admin.role_granted"` after `| "admin.action"` in `SecurityEventType`, and in `SECURITY_EVENT_SEVERITY` after `"admin.action": "info",`:

```ts
  // A new platform ADMIN can read and change every tenant. Rare, deliberate, and the single
  // most valuable thing to know about if it was not you.
  "admin.role_granted": "critical",
```

- [ ] **Step 4: Emit it, and pin it in the catalog tests**

In `admin/actions.ts` `adminCreateUser`, directly after the `prisma.user.create(...)` call (before `logAdminAction`):

```ts
  if (user.role === "ADMIN") {
    securityEvent("admin.role_granted", {
      userId: actorId,
      targetUserId: user.id,
      meta: { to: "ADMIN", trigger: "admin_create_user" },
    });
  }
```

In `adminUpdateUser`, inside the existing `if (roleChanged) {` block, after the `session.invalidated` event:

```ts
    if (updates.role === "ADMIN") {
      securityEvent("admin.role_granted", {
        userId: actorId,
        targetUserId: userId,
        meta: { from: before?.role, to: "ADMIN", trigger: "admin_update_user" },
      });
    }
```

In `src/lib/__tests__/security-events.test.ts` add `"admin.role_granted",` to the pinned `expected` list next to `"admin.action",`. In `src/__tests__/security-event-wiring.test.ts` add to `WIRING`:

```ts
  { type: "admin.role_granted", file: "app/(dashboard)/admin/actions.ts" },
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:integration -- src/integration/admin-role-granted.itest.ts && npx vitest run src/lib/__tests__/security-events.test.ts src/__tests__/security-event-wiring.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/security-events.ts "src/app/(dashboard)/admin/actions.ts" src/lib/__tests__/security-events.test.ts src/__tests__/security-event-wiring.test.ts src/integration/admin-role-granted.itest.ts
git diff --name-only --cached
git commit -m "Emit a critical admin.role_granted event when a platform ADMIN is created (SECH-117)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Alert tables (migration)

**Files:**
- Modify: `prisma/schema.prisma` (after `RateLimitAttempt`, ~line 819)
- Create: `prisma/migrations/20260925000000_add_alerting/migration.sql`

**Interfaces:**
- Produces: `prisma.alertEvent` (`id, rule, subject, detail?, createdAt`) and `prisma.alertState` (compound id `rule_subject`; `lastSentAt`, `suppressedCount`).

- [ ] **Step 1: Add the models**

Append to `prisma/schema.prisma` after `model RateLimitAttempt`:

```prisma
/// SECH-117: observations that threshold alert rules count, plus the "_sent" ledger the
/// global cap reads. `detail` is a hash prefix used for distinct-account counting — never a
/// raw email. Rows older than 24h are pruned.
model AlertEvent {
  id        String   @id @default(cuid())
  rule      String
  subject   String
  detail    String?
  createdAt DateTime @default(now())

  @@index([rule, subject, createdAt])
}

/// SECH-117: per (rule, subject) cooldown. One atomic upsert claims a send, so two
/// instances cannot both email. Rows older than 7 days are pruned.
model AlertState {
  rule            String
  subject         String
  lastSentAt      DateTime
  suppressedCount Int      @default(0)

  @@id([rule, subject])
}
```

- [ ] **Step 2: Write the migration by hand**

Create `prisma/migrations/20260925000000_add_alerting/migration.sql`:

```sql
-- SECH-117: owner alerting counters and cooldown state.
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AlertEvent_rule_subject_createdAt_idx" ON "AlertEvent"("rule", "subject", "createdAt");

CREATE TABLE "AlertState" (
    "rule" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "suppressedCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AlertState_pkey" PRIMARY KEY ("rule", "subject")
);
```

- [ ] **Step 3: Apply and confirm there is no drift**

```bash
npx prisma migrate deploy && npx prisma generate
npx prisma migrate diff --from-url "$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')" --to-schema-datamodel prisma/schema.prisma --exit-code && echo "NO DRIFT"
```
Expected: `NO DRIFT` (exit 0). If it reports differences, fix the SQL to match the schema; do not edit the schema to match a wrong migration. If the non-interactive-TTY problem in `.context-docs/migrations.md` appears, follow that recipe.

- [ ] **Step 4: Type-check and commit**

```bash
npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations/20260925000000_add_alerting
git diff --name-only --cached
git commit -m "Add AlertEvent and AlertState tables for owner alerting (SECH-117)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Config, rules and pure evaluation

**Files:**
- Create: `src/lib/alerting/config.ts`, `src/lib/alerting/rules.ts`, `src/lib/alerting/evaluate.ts`
- Test: `src/lib/__tests__/alerting-rules.test.ts`, `src/lib/__tests__/alerting-config.test.ts`

**Interfaces:**
- Produces (`config.ts`): `ALERT_FROM: string`, `interface AlertConfig { enabled: boolean; ready: boolean; to: string | undefined; missing: string[] }`, `alertingEnabled(env?): boolean`, `getAlertConfig(env?): AlertConfig`.
- Produces (`rules.ts`): `type AlertRuleId`, `interface AlertableRecord`, `interface AlertRule`, `ALERT_RULES: readonly AlertRule[]`, `ALERT_SOURCE_TYPES: ReadonlySet<string>`, `GLOBAL_CAP_PER_HOUR = 10`, `RETRY_AFTER_FAILURE_MS`.
- Produces (`evaluate.ts`): `interface Observation { rule: AlertRule; subject: string; detail?: string }`, `observationsFor(record): Observation[]`, `isTripped(rule, count): boolean`, `hashDetail(raw): string`.
- Rule shape: `{ id, title, severity, sources, subject(record), distinctBy?(record), threshold?: { count, windowMs }, cooldownMs, summary }`.

- [ ] **Step 1: Write the failing tests**

`src/lib/__tests__/alerting-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getAlertConfig, alertingEnabled } from "@/lib/alerting/config";

describe("getAlertConfig", () => {
  it("is off unless ALERTING_ENABLED is exactly 'true'", () => {
    expect(alertingEnabled({})).toBe(false);
    expect(alertingEnabled({ ALERTING_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(alertingEnabled({ ALERTING_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("is ready only when enabled AND recipient AND Resend key are set", () => {
    const env = { ALERTING_ENABLED: "true", ALERT_EMAIL_TO: "o@example.test", RESEND_API_KEY: "re_x" } as NodeJS.ProcessEnv;
    expect(getAlertConfig(env)).toMatchObject({ enabled: true, ready: true, to: "o@example.test", missing: [] });
  });

  // Review Focus 6: enabled-but-misconfigured must be distinguishable from "quiet".
  it("reports exactly which variable is missing when enabled", () => {
    const cfg = getAlertConfig({ ALERTING_ENABLED: "true" } as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(true);
    expect(cfg.ready).toBe(false);
    expect(cfg.missing).toEqual(["ALERT_EMAIL_TO", "RESEND_API_KEY"]);
  });

  it("treats a whitespace-only recipient as missing", () => {
    const cfg = getAlertConfig({ ALERTING_ENABLED: "true", ALERT_EMAIL_TO: "   ", RESEND_API_KEY: "re_x" } as NodeJS.ProcessEnv);
    expect(cfg.missing).toEqual(["ALERT_EMAIL_TO"]);
  });
});
```

`src/lib/__tests__/alerting-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ALERT_RULES } from "@/lib/alerting/rules";
import { observationsFor, isTripped, hashDetail } from "@/lib/alerting/evaluate";

const base = { ts: "2026-09-25T00:00:00.000Z", requestId: "req-1" };
const rule = (id: string) => ALERT_RULES.find((r) => r.id === id)!;
const only = (r: ReturnType<typeof observationsFor>) => r.map((o) => o.rule.id);

describe("login_spray", () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    ...base, type: "auth.login_failed", ip: "198.51.100.7", meta: { emailAttempted: "Victim@Example.test" }, ...over,
  });

  it("groups by IP and counts accounts by hash, never the raw address", () => {
    const [obs] = observationsFor(rec());
    expect(obs.rule.id).toBe("login_spray");
    expect(obs.subject).toBe("198.51.100.7");
    expect(obs.detail).toMatch(/^[0-9a-f]{16}$/);
    expect(obs.detail).not.toContain("@");
  });

  it("hashes case-insensitively so one account in two cases counts once", () => {
    expect(hashDetail("Victim@Example.test")).toBe(hashDetail(" victim@example.TEST "));
  });

  it("counts throttled logins too", () => {
    expect(only(observationsFor(rec({ type: "auth.login_throttled" })))).toEqual(["login_spray"]);
  });

  // Review Focus 2: bucketing every header-less request under one subject would let a
  // handful of unrelated failures trip the rule.
  it("drops an event with no usable IP or no account", () => {
    expect(observationsFor(rec({ ip: "unknown" }))).toEqual([]);
    expect(observationsFor(rec({ ip: undefined }))).toEqual([]);
    expect(observationsFor(rec({ meta: {} }))).toEqual([]);
    expect(observationsFor(rec({ meta: { emailAttempted: "" } }))).toEqual([]);
  });

  it("trips at 10 distinct accounts, not 9", () => {
    expect(isTripped(rule("login_spray"), 9)).toBe(false);
    expect(isTripped(rule("login_spray"), 10)).toBe(true);
  });
});

describe("immediate rules", () => {
  it("refresh_reuse groups by user; missing user is dropped", () => {
    expect(observationsFor({ ...base, type: "oauth.refresh_reuse_detected", userId: "u1" })[0]).toMatchObject({ subject: "u1" });
    expect(observationsFor({ ...base, type: "oauth.refresh_reuse_detected" })).toEqual([]);
  });

  it("revoked_key_used groups by meta.apiKeyId", () => {
    expect(observationsFor({ ...base, type: "apikey.used_after_revoke", meta: { apiKeyId: "k1" } })[0]).toMatchObject({ subject: "k1" });
    expect(observationsFor({ ...base, type: "apikey.used_after_revoke", meta: {} })).toEqual([]);
  });

  it("admin_role_granted groups by the grantee and has no cooldown", () => {
    const [obs] = observationsFor({ ...base, type: "admin.role_granted", userId: "admin1", targetUserId: "u9" });
    expect(obs).toMatchObject({ subject: "u9" });
    expect(obs.rule.cooldownMs).toBe(0);
  });

  it("immediate rules trip on any count", () => {
    for (const id of ["refresh_reuse", "revoked_key_used", "admin_role_granted"]) {
      expect(isTripped(rule(id), 1)).toBe(true);
    }
  });
});

describe("threshold rules", () => {
  it("authz_probe counts the four warn-level denials by acting user and ignores denied_role", () => {
    for (const type of ["authz.denied_not_member", "authz.denied_private_project", "authz.denied_not_org_member", "authz.denied_admin"]) {
      expect(only(observationsFor({ ...base, type, userId: "u1" }))).toEqual(["authz_probe"]);
    }
    expect(observationsFor({ ...base, type: "authz.denied_role", userId: "u1" })).toEqual([]);
    expect(observationsFor({ ...base, type: "authz.denied_not_member" })).toEqual([]);
    expect(isTripped(rule("authz_probe"), 9)).toBe(false);
    expect(isTripped(rule("authz_probe"), 10)).toBe(true);
  });

  it("error_spike counts app and prisma errors under one global subject", () => {
    expect(observationsFor({ ...base, type: "app.error" })[0]).toMatchObject({ subject: "global" });
    expect(observationsFor({ ...base, type: "prisma.error" })[0]).toMatchObject({ subject: "global" });
    expect(isTripped(rule("error_spike"), 19)).toBe(false);
    expect(isTripped(rule("error_spike"), 20)).toBe(true);
  });
});

it("ignores event types no rule listens to", () => {
  expect(observationsFor({ ...base, type: "csp.violation" })).toEqual([]);
  expect(observationsFor({ ...base, type: "admin.action", userId: "u1" })).toEqual([]);
});

it("spec table: windows and cooldowns", () => {
  const MIN = 60_000;
  expect(rule("login_spray")).toMatchObject({ threshold: { count: 10, windowMs: 10 * MIN }, cooldownMs: 60 * MIN });
  expect(rule("authz_probe")).toMatchObject({ threshold: { count: 10, windowMs: 10 * MIN }, cooldownMs: 60 * MIN });
  expect(rule("error_spike")).toMatchObject({ threshold: { count: 20, windowMs: 5 * MIN }, cooldownMs: 30 * MIN });
  expect(rule("refresh_reuse")).toMatchObject({ cooldownMs: 60 * MIN });
  expect(rule("revoked_key_used")).toMatchObject({ cooldownMs: 60 * MIN });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/__tests__/alerting-config.test.ts src/lib/__tests__/alerting-rules.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `config.ts`**

```ts
/**
 * Alerting configuration (SECH-117).
 *
 * Deliberately import-free: security-events.ts loads this statically on every emit, and it
 * must not drag Prisma or Resend into that path.
 */
export const ALERT_FROM = "JedForge Alerts <alerts@jedforge.com>";

export interface AlertConfig {
  /** ALERTING_ENABLED is exactly "true". Unset means off, which is the merge-dormant default. */
  enabled: boolean;
  /** Enabled AND everything needed to send is present. */
  ready: boolean;
  to: string | undefined;
  /** Names of missing variables. Non-empty + enabled is a misconfiguration, not silence. */
  missing: string[];
}

export function alertingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALERTING_ENABLED === "true";
}

export function getAlertConfig(env: NodeJS.ProcessEnv = process.env): AlertConfig {
  const enabled = alertingEnabled(env);
  const to = env.ALERT_EMAIL_TO?.trim() || undefined;
  const missing: string[] = [];
  if (!to) missing.push("ALERT_EMAIL_TO");
  if (!env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
  return { enabled, ready: enabled && missing.length === 0, to, missing };
}
```

- [ ] **Step 4: Implement `rules.ts`**

```ts
/**
 * Alert rules (SECH-117). Data only, and import-free: security-events.ts reads
 * ALERT_SOURCE_TYPES on every emit to decide whether alerting needs to be loaded at all.
 *
 * Thresholds live here, in code, on purpose: a Railway env change restarts the service
 * anyway, so an env override saves almost nothing and loses test coverage.
 */

export type AlertRuleId =
  | "login_spray"
  | "refresh_reuse"
  | "revoked_key_used"
  | "admin_role_granted"
  | "authz_probe"
  | "error_spike";

/** The subset of a security-event record alerting reads (post-redaction). */
export interface AlertableRecord {
  type: string;
  ts: string;
  requestId?: string;
  userId?: string;
  targetUserId?: string;
  orgId?: string;
  ip?: string;
  meta?: Record<string, unknown>;
}

export interface AlertRule {
  id: AlertRuleId;
  title: string;
  severity: "warn" | "critical";
  /** Event types this rule listens to. Must all exist in the SECH-114 catalog. */
  sources: readonly string[];
  /** What the rule groups by. Undefined drops the observation rather than bucketing it. */
  subject: (r: AlertableRecord) => string | undefined;
  /** When set, the threshold counts DISTINCT values of this, not events. */
  distinctBy?: (r: AlertableRecord) => string | undefined;
  /** Absent = fires on every occurrence. */
  threshold?: { count: number; windowMs: number };
  /** 0 = no cooldown (every occurrence emails, still subject to the global cap). */
  cooldownMs: number;
  /** One line for the email body. */
  summary: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

export const ALERT_RULES: readonly AlertRule[] = [
  {
    id: "login_spray",
    title: "Login attempts across many accounts from one IP",
    severity: "warn",
    sources: ["auth.login_failed", "auth.login_throttled"],
    // "unknown" means the client IP could not be derived; grouping on it would pool unrelated
    // failures into one subject.
    subject: (r) => (r.ip && r.ip !== "unknown" ? r.ip : undefined),
    distinctBy: (r) => str(r.meta?.emailAttempted),
    threshold: { count: 10, windowMs: 10 * MINUTE },
    cooldownMs: HOUR,
    summary:
      "One IP failed to log in to many different accounts in a short window — credential stuffing looks like this because it tries one password per account and never hits the per-account throttle.",
  },
  {
    id: "refresh_reuse",
    title: "Refresh-token reuse detected",
    severity: "critical",
    sources: ["oauth.refresh_reuse_detected"],
    subject: (r) => str(r.userId),
    cooldownMs: HOUR,
    summary:
      "A revoked OAuth refresh token was presented again. Either a token leaked or a token family was cloned; the whole family has been revoked.",
  },
  {
    id: "revoked_key_used",
    title: "Revoked API key used",
    severity: "critical",
    sources: ["apikey.used_after_revoke"],
    subject: (r) => str(r.meta?.apiKeyId),
    cooldownMs: HOUR,
    summary:
      "A revoked org API key is still being presented. The holder has not noticed, or is not the person it was revoked from.",
  },
  {
    id: "admin_role_granted",
    title: "Platform ADMIN role granted",
    severity: "critical",
    sources: ["admin.role_granted"],
    subject: (r) => str(r.targetUserId),
    cooldownMs: 0,
    summary: "A user was given the platform ADMIN role, which can read and change every tenant. If this was not you, act now.",
  },
  {
    id: "authz_probe",
    title: "Repeated cross-tenant authorization denials",
    severity: "warn",
    sources: [
      "authz.denied_not_member",
      "authz.denied_private_project",
      "authz.denied_not_org_member",
      "authz.denied_admin",
    ],
    subject: (r) => str(r.userId),
    threshold: { count: 10, windowMs: 10 * MINUTE },
    cooldownMs: HOUR,
    summary:
      "One signed-in user has been refused many times for projects or orgs they do not belong to, or for admin pages — a tenant-boundary probe.",
  },
  {
    id: "error_spike",
    title: "Application error spike",
    severity: "warn",
    sources: ["app.error", "prisma.error"],
    subject: () => "global",
    threshold: { count: 20, windowMs: 5 * MINUTE },
    cooldownMs: 30 * MINUTE,
    summary: "The application logged many errors in a short window. Check Deploy Logs for the app.error / prisma.error events.",
  },
];

export const ALERT_SOURCE_TYPES: ReadonlySet<string> = new Set(ALERT_RULES.flatMap((r) => [...r.sources]));

/** Soft global flood guard — two instances can overshoot by one. */
export const GLOBAL_CAP_PER_HOUR = 10;

/** After a failed send, a matching event may retry once this much of the cooldown has passed. */
export const RETRY_AFTER_FAILURE_MS = 5 * MINUTE;
```

- [ ] **Step 5: Implement `evaluate.ts`**

```ts
import { createHash } from "node:crypto";
import { ALERT_RULES, type AlertRule, type AlertableRecord } from "./rules";

export interface Observation {
  rule: AlertRule;
  subject: string;
  /** Hash prefix used for distinct counting. Never a raw value. */
  detail?: string;
}

/**
 * A 16-hex prefix of the hash of the lowercased value. Enough to count distinct accounts in a
 * 24-hour operational table that is never exported or emailed; not a way to store an address.
 */
export function hashDetail(raw: string): string {
  return createHash("sha256").update(raw.trim().toLowerCase()).digest("hex").slice(0, 16);
}

/** Pure: which rules care about this record, and under what subject. */
export function observationsFor(record: AlertableRecord): Observation[] {
  const out: Observation[] = [];
  for (const rule of ALERT_RULES) {
    if (!rule.sources.includes(record.type)) continue;
    const subject = rule.subject(record);
    if (!subject) continue;
    if (rule.distinctBy) {
      const raw = rule.distinctBy(record);
      if (!raw) continue;
      out.push({ rule, subject, detail: hashDetail(raw) });
    } else {
      out.push({ rule, subject });
    }
  }
  return out;
}

export function isTripped(rule: AlertRule, count: number): boolean {
  return !rule.threshold || count >= rule.threshold.count;
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `npx vitest run src/lib/__tests__/alerting-config.test.ts src/lib/__tests__/alerting-rules.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/alerting/config.ts src/lib/alerting/rules.ts src/lib/alerting/evaluate.ts src/lib/__tests__/alerting-config.test.ts src/lib/__tests__/alerting-rules.test.ts
git diff --name-only --cached
git commit -m "Add alert rules, config and pure evaluation (SECH-117)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: The Postgres store

**Files:**
- Create: `src/lib/alerting/store.ts`
- Test: `src/integration/alerting-store.itest.ts`

**Interfaces:**
- Consumes: `prisma.alertEvent`, `prisma.alertState` (Task 2).
- Produces (all async):
  - `recordObservation(rule: string, subject: string, detail?: string): Promise<void>`
  - `countInWindow(rule: string, subject: string, windowMs: number, distinct: boolean): Promise<number>`
  - `claimSend(rule: string, subject: string, cooldownMs: number): Promise<{ claimed: boolean; suppressed: number }>` — `suppressed` is the PRIOR count, meaningful only when `claimed`.
  - `backdateClaim(rule: string, subject: string, cooldownMs: number, retryMs: number): Promise<void>`
  - `recordSent(): Promise<void>`, `sentInLastHour(): Promise<number>`, `prune(): Promise<void>`.

- [ ] **Step 1: Write the failing integration test**

`src/integration/alerting-store.itest.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import * as store from "@/lib/alerting/store";

const MIN = 60_000;
const HOUR = 60 * MIN;

beforeEach(async () => {
  await prisma.alertEvent.deleteMany();
  await prisma.alertState.deleteMany();
});

const ageState = (rule: string, subject: string, ms: number) =>
  prisma.alertState.update({
    where: { rule_subject: { rule, subject } },
    data: { lastSentAt: new Date(Date.now() - ms) },
  });

describe("claimSend", () => {
  it("the first claim wins; a claim inside the cooldown loses and is counted", async () => {
    expect(await store.claimSend("r", "s", HOUR)).toEqual({ claimed: true, suppressed: 0 });
    expect(await store.claimSend("r", "s", HOUR)).toEqual({ claimed: false, suppressed: 0 });
    expect(await store.claimSend("r", "s", HOUR)).toEqual({ claimed: false, suppressed: 0 });
    expect((await prisma.alertState.findUnique({ where: { rule_subject: { rule: "r", subject: "s" } } }))!.suppressedCount).toBe(2);
  });

  it("after the cooldown the next claim wins, reports the prior suppressed count, and resets it", async () => {
    await store.claimSend("r", "s", HOUR);
    await store.claimSend("r", "s", HOUR);
    await store.claimSend("r", "s", HOUR);
    await ageState("r", "s", HOUR + MIN);
    expect(await store.claimSend("r", "s", HOUR)).toEqual({ claimed: true, suppressed: 2 });
    expect((await prisma.alertState.findUnique({ where: { rule_subject: { rule: "r", subject: "s" } } }))!.suppressedCount).toBe(0);
  });

  it("different subjects and rules have independent cooldowns", async () => {
    expect((await store.claimSend("r", "a", HOUR)).claimed).toBe(true);
    expect((await store.claimSend("r", "b", HOUR)).claimed).toBe(true);
    expect((await store.claimSend("other", "a", HOUR)).claimed).toBe(true);
  });

  // Review Focus 3: two instances racing on one cooldown must send exactly once.
  it("concurrent claims produce exactly one winner", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => store.claimSend("race", "s", HOUR)));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
  });
});

describe("backdateClaim", () => {
  // Review Focus 4: a failed send must not silence the rule for the whole cooldown.
  it("lets the next claim through after the retry delay, not before", async () => {
    await store.claimSend("r", "s", HOUR);
    await store.backdateClaim("r", "s", HOUR, 5 * MIN);
    expect((await store.claimSend("r", "s", HOUR)).claimed).toBe(false); // still inside the 5 min retry gap
    await ageState("r", "s", HOUR - 5 * MIN + 6 * MIN); // ...then the retry gap elapses
    expect((await store.claimSend("r", "s", HOUR)).claimed).toBe(true);
  });
});

describe("countInWindow", () => {
  it("counts events for one rule+subject inside the window only", async () => {
    await store.recordObservation("r", "s");
    await store.recordObservation("r", "s");
    await store.recordObservation("r", "other");
    await store.recordObservation("elsewhere", "s");
    const old = await prisma.alertEvent.create({ data: { rule: "r", subject: "s" } });
    await prisma.alertEvent.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 11 * MIN) } });
    expect(await store.countInWindow("r", "s", 10 * MIN, false)).toBe(2);
  });

  it("counts distinct details, so one account failing repeatedly counts once", async () => {
    for (const d of ["a", "a", "a", "b", "c"]) await store.recordObservation("r", "ip", d);
    expect(await store.countInWindow("r", "ip", 10 * MIN, true)).toBe(3);
    expect(await store.countInWindow("r", "ip", 10 * MIN, false)).toBe(5);
  });
});

describe("global cap ledger and pruning", () => {
  it("recordSent / sentInLastHour count only recent sends", async () => {
    await store.recordSent();
    await store.recordSent();
    const old = await prisma.alertEvent.create({ data: { rule: "_sent", subject: "global" } });
    await prisma.alertEvent.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 2 * HOUR) } });
    expect(await store.sentInLastHour()).toBe(2);
  });

  it("prune removes events older than 24h and state older than 7d, keeping the rest", async () => {
    const oldEvt = await prisma.alertEvent.create({ data: { rule: "r", subject: "s" } });
    await prisma.alertEvent.update({ where: { id: oldEvt.id }, data: { createdAt: new Date(Date.now() - 25 * HOUR) } });
    await store.recordObservation("r", "fresh");
    await store.claimSend("old", "s", HOUR);
    await ageState("old", "s", 8 * 24 * HOUR);
    await store.claimSend("new", "s", HOUR);

    await store.prune();

    expect((await prisma.alertEvent.findMany()).map((e) => e.subject)).toEqual(["fresh"]);
    expect((await prisma.alertState.findMany()).map((s) => s.rule)).toEqual(["new"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- src/integration/alerting-store.itest.ts`
Expected: FAIL — `@/lib/alerting/store` not found.

- [ ] **Step 3: Implement `store.ts`**

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The only Prisma access in the alerting subsystem (SECH-117).
 *
 * Everything here is durable Postgres state so counts and cooldowns are shared across
 * instances and survive restarts — the same reasoning as RateLimitAttempt.
 */

const SENT_RULE = "_sent";
const HOUR = 60 * 60 * 1000;
const STALE_EVENT_MS = 24 * HOUR;
const STALE_STATE_MS = 7 * 24 * HOUR;

export async function recordObservation(rule: string, subject: string, detail?: string): Promise<void> {
  await prisma.alertEvent.create({ data: { rule, subject, detail } });
  // Keys that never recur are otherwise never cleaned up (same housekeeping as the limiter).
  if (Math.random() < 0.01) await prune().catch(() => {});
}

export async function countInWindow(
  rule: string,
  subject: string,
  windowMs: number,
  distinct: boolean
): Promise<number> {
  const where = { rule, subject, createdAt: { gte: new Date(Date.now() - windowMs) } };
  if (!distinct) return prisma.alertEvent.count({ where });
  const rows = await prisma.alertEvent.findMany({ where, distinct: ["detail"], select: { detail: true } });
  return rows.length;
}

/**
 * Atomically claim the right to send for (rule, subject).
 *
 * One statement, so two instances cannot both win: under READ COMMITTED the loser's
 * ON CONFLICT ... WHERE re-checks the row the winner just wrote and finds it inside the
 * cooldown. Uses the database clock throughout. `prior` is read from the statement snapshot,
 * i.e. the suppressed count as it stood BEFORE the winner reset it.
 */
export async function claimSend(
  rule: string,
  subject: string,
  cooldownMs: number
): Promise<{ claimed: boolean; suppressed: number }> {
  const rows = await prisma.$queryRaw<Array<{ claimed: number; suppressed: number }>>(Prisma.sql`
    WITH prior AS (
      SELECT "suppressedCount" FROM "AlertState" WHERE "rule" = ${rule} AND "subject" = ${subject}
    ), won AS (
      INSERT INTO "AlertState" ("rule", "subject", "lastSentAt", "suppressedCount")
      VALUES (${rule}, ${subject}, now(), 0)
      ON CONFLICT ("rule", "subject") DO UPDATE
        SET "lastSentAt" = now(), "suppressedCount" = 0
        WHERE "AlertState"."lastSentAt" < now() - (${cooldownMs}::double precision * interval '1 millisecond')
      RETURNING 1 AS one
    )
    SELECT (SELECT count(*) FROM won)::int AS claimed,
           COALESCE((SELECT "suppressedCount" FROM prior), 0)::int AS suppressed
  `);
  const { claimed, suppressed } = rows[0];
  if (claimed > 0) return { claimed: true, suppressed };
  // A loss means the row exists and is inside its cooldown: remember we swallowed one.
  await prisma.alertState.updateMany({ where: { rule, subject }, data: { suppressedCount: { increment: 1 } } });
  return { claimed: false, suppressed: 0 };
}

/**
 * After a failed send: pretend the last send was `cooldownMs - retryMs` ago, so a matching
 * event can retry after `retryMs` instead of being silenced for the whole cooldown.
 */
export async function backdateClaim(rule: string, subject: string, cooldownMs: number, retryMs: number): Promise<void> {
  await prisma.alertState.updateMany({
    where: { rule, subject },
    data: { lastSentAt: new Date(Date.now() - cooldownMs + retryMs) },
  });
}

export async function recordSent(): Promise<void> {
  await prisma.alertEvent.create({ data: { rule: SENT_RULE, subject: "global" } });
}

export async function sentInLastHour(): Promise<number> {
  return prisma.alertEvent.count({ where: { rule: SENT_RULE, createdAt: { gte: new Date(Date.now() - HOUR) } } });
}

export async function prune(): Promise<void> {
  await prisma.alertEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - STALE_EVENT_MS) } } });
  await prisma.alertState.deleteMany({ where: { lastSentAt: { lt: new Date(Date.now() - STALE_STATE_MS) } } });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:integration -- src/integration/alerting-store.itest.ts`
Expected: PASS. If `claimSend` returns a `bigint`/type error, the `::int` casts in the SELECT are the fix. If the concurrency test yields more than one winner, stop — the claim is not atomic and everything downstream is unsafe.

- [ ] **Step 5: Commit**

```bash
git add src/lib/alerting/store.ts src/integration/alerting-store.itest.ts
git diff --name-only --cached
git commit -m "Add the Postgres-backed alert store with an atomic cooldown claim (SECH-117)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Email template and delivery

**Files:**
- Create: `src/emails/SecurityAlertEmail.tsx`, `src/lib/alerting/deliver.ts`
- Test: `src/lib/__tests__/alerting-deliver.test.ts`

**Interfaces:**
- Consumes: `ALERT_FROM` (Task 3).
- Produces (`deliver.ts`):
  ```ts
  export interface AlertMessage {
    rule: string;               // rule id, or "alert_cap"
    title: string;
    severity: "warn" | "critical";
    summary: string;
    subject: string;            // ip / user id / key id / "global" — an identifier, never a credential
    count?: number;
    windowMinutes?: number;
    suppressed: number;         // swallowed since the last email for this rule+subject
    triggeredAt: string;        // ISO
    requestId?: string;
    drill: boolean;
  }
  export function alertEmailSubject(msg: AlertMessage): string;
  export function sendAlertEmail(msg: AlertMessage, to: string): Promise<{ success: boolean; error?: string }>;
  ```

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/alerting-deliver.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: h.send }; } }));

import { sendAlertEmail, alertEmailSubject, type AlertMessage } from "@/lib/alerting/deliver";
import { ALERT_FROM } from "@/lib/alerting/config";

const msg = (over: Partial<AlertMessage> = {}): AlertMessage => ({
  rule: "refresh_reuse",
  title: "Refresh-token reuse detected",
  severity: "critical",
  summary: "A revoked OAuth refresh token was presented again.",
  subject: "user_abc123",
  suppressed: 0,
  triggeredAt: "2026-09-25T12:00:00.000Z",
  requestId: "0f8c1d2e-1111-4222-8333-444455556666",
  drill: false,
  ...over,
});

beforeEach(() => {
  h.send.mockReset();
  h.send.mockResolvedValue({ data: { id: "e1" }, error: null });
  process.env.RESEND_API_KEY = "re_test";
});

describe("sendAlertEmail", () => {
  it("sends one email from the alerts address to the owner with the rule facts in the body", async () => {
    expect(await sendAlertEmail(msg({ suppressed: 4 }), "owner@example.test")).toEqual({ success: true });
    expect(h.send).toHaveBeenCalledTimes(1);
    const payload = h.send.mock.calls[0][0];
    expect(payload.from).toBe(ALERT_FROM);
    expect(payload.to).toBe("owner@example.test");
    expect(payload.subject).toBe("[JedForge CRITICAL] Refresh-token reuse detected");
    expect(typeof payload.html).toBe("string"); // rendered before send (email.md gotcha)
    for (const needle of ["Refresh-token reuse detected", "user_abc123", "0f8c1d2e-1111-4222-8333-444455556666", "4"]) {
      expect(payload.html).toContain(needle);
    }
  });

  it("prefixes drill emails so they cannot be mistaken for real alerts", () => {
    expect(alertEmailSubject(msg({ drill: true }))).toBe("[DRILL] [JedForge CRITICAL] Refresh-token reuse detected");
  });

  it("includes the count and window for threshold alerts", async () => {
    await sendAlertEmail(msg({ rule: "authz_probe", count: 12, windowMinutes: 10 }), "o@example.test");
    const html: string = h.send.mock.calls[0][0].html;
    expect(html).toContain("12");
    expect(html).toContain("10 minutes");
  });

  it("returns the provider error instead of throwing", async () => {
    h.send.mockResolvedValue({ data: null, error: { message: "domain not verified" } });
    expect(await sendAlertEmail(msg(), "o@example.test")).toEqual({ success: false, error: "domain not verified" });
  });

  it("returns a thrown error instead of throwing", async () => {
    h.send.mockRejectedValue(new Error("network down"));
    expect(await sendAlertEmail(msg(), "o@example.test")).toEqual({ success: false, error: "network down" });
  });

  // AlertMessage has no field that can carry a credential or an address, so the body is built
  // from those fields only. (Task 6's integration test proves the address never reaches here.)
  it("puts the recipient in the envelope only, not the body", async () => {
    await sendAlertEmail(msg({ subject: "203.0.113.9" }), "owner@example.test");
    const html: string = h.send.mock.calls[0][0].html;
    expect(html).toContain("203.0.113.9");
    expect(html).not.toContain("owner@example.test");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/alerting-deliver.test.ts`
Expected: FAIL — `@/lib/alerting/deliver` not found.

- [ ] **Step 3: Implement the template**

`src/emails/SecurityAlertEmail.tsx` (styled like `OrgInviteEmail`; plain, readable in any client):

```tsx
import { Body, Container, Head, Heading, Hr, Html, Preview, Section, Text } from "@react-email/components";
import * as React from "react";
import type { AlertMessage } from "@/lib/alerting/deliver";

export function SecurityAlertEmail(props: AlertMessage) {
  const rows: Array<[string, string]> = [
    ["Rule", props.rule],
    ["Severity", props.severity],
    ["Subject", props.subject],
    ...(props.count !== undefined
      ? ([["Count", props.windowMinutes ? `${props.count} in ${props.windowMinutes} minutes` : String(props.count)]] as Array<[string, string]>)
      : []),
    ["Suppressed since last alert", String(props.suppressed)],
    ["Time", props.triggeredAt],
    ...(props.requestId ? ([["Request ID", props.requestId]] as Array<[string, string]>) : []),
  ];

  return (
    <Html lang="en">
      <Head />
      <Preview>{props.title}</Preview>
      <Body style={body}>
        <Container style={container}>
          {props.drill && <Text style={drillBanner}>DRILL — this is a test of the alerting path, not a real event.</Text>}
          <Heading style={heading}>{props.title}</Heading>
          <Text style={paragraph}>{props.summary}</Text>
          <Section>
            {rows.map(([k, v]) => (
              <Text key={k} style={row}>
                <strong>{k}:</strong> {v}
              </Text>
            ))}
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            Open Railway → Deploy Logs and filter on the event type. The request ID ties this alert to the log lines.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body = { backgroundColor: "#f4f4f5", fontFamily: "system-ui, -apple-system, sans-serif" };
const container = { backgroundColor: "#ffffff", margin: "24px auto", padding: "24px", maxWidth: "560px", borderRadius: "8px" };
const heading = { fontSize: "20px", color: "#18181b", margin: "0 0 12px" };
const paragraph = { fontSize: "14px", color: "#3f3f46", lineHeight: "20px" };
const row = { fontSize: "13px", color: "#27272a", margin: "2px 0", wordBreak: "break-all" as const };
const hr = { borderColor: "#e4e4e7", margin: "20px 0" };
const footer = { fontSize: "12px", color: "#71717a" };
const drillBanner = { backgroundColor: "#fef3c7", color: "#92400e", padding: "8px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 600 };
```

- [ ] **Step 4: Implement `deliver.ts`**

```ts
import { Resend } from "resend";
import { render } from "@react-email/components";
import { SecurityAlertEmail } from "@/emails/SecurityAlertEmail";
import { ALERT_FROM } from "./config";

export interface AlertMessage {
  rule: string;
  title: string;
  severity: "warn" | "critical";
  summary: string;
  subject: string;
  count?: number;
  windowMinutes?: number;
  suppressed: number;
  triggeredAt: string;
  requestId?: string;
  drill: boolean;
}

export function alertEmailSubject(msg: AlertMessage): string {
  return `${msg.drill ? "[DRILL] " : ""}[JedForge ${msg.severity.toUpperCase()}] ${msg.title}`;
}

/**
 * Never throws: alerting must not be the reason anything fails. The Resend client is built
 * inside the function (module-level construction breaks CI's static page-data step) and the
 * template is rendered to html first because `react:` fails at runtime — see email.md.
 */
export async function sendAlertEmail(
  msg: AlertMessage,
  to: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const html = await render(SecurityAlertEmail(msg));
    const result = await resend.emails.send({ from: ALERT_FROM, to, subject: alertEmailSubject(msg), html });
    if (result.error) return { success: false, error: result.error.message };
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/__tests__/alerting-deliver.test.ts`
Expected: PASS. If `render` fails under Vitest's environment, mock `@react-email/components`'s `render` in this test to return `JSON.stringify(props)` and assert on that — but first confirm it is an environment issue, not a template bug.

- [ ] **Step 6: Commit**

```bash
git add src/emails/SecurityAlertEmail.tsx src/lib/alerting/deliver.ts src/lib/__tests__/alerting-deliver.test.ts
git diff --name-only --cached
git commit -m "Add the security alert email and Resend delivery (SECH-117)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `observe()` — cooldown, cap and failure handling

**Files:**
- Create: `src/lib/alerting/log.ts`, `src/lib/alerting/index.ts`
- Test: `src/integration/alerting-flow.itest.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–5.
- Produces:
  - `alertingFailure(kind: string, detail?: unknown, opts?: { once?: boolean }): void` (`log.ts`)
  - `observe(record: AlertableRecord): Promise<void>` — never rejects.
  - `dispatch(rule: AlertRule, subject: string, ctx: DispatchContext): Promise<DispatchResult>` where `DispatchContext = { to: string; drill: boolean; requestId?: string; count?: number }` and `DispatchResult = { sent: boolean; reason?: "cap" | "cooldown" | "send_failed"; error?: string }` (exported for Task 9).

- [ ] **Step 1: Write the failing integration test**

`src/integration/alerting-flow.itest.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: h.send }; } }));

import { prisma } from "@/lib/prisma";
import { observe } from "@/lib/alerting";
import { GLOBAL_CAP_PER_HOUR } from "@/lib/alerting/rules";
import { resetAlertingWarningsForTest } from "@/lib/alerting/log";

const MIN = 60_000;
const ts = () => new Date().toISOString();

beforeEach(async () => {
  await prisma.alertEvent.deleteMany();
  await prisma.alertState.deleteMany();
  h.send.mockReset();
  h.send.mockResolvedValue({ data: { id: "e" }, error: null });
  resetAlertingWarningsForTest();
  vi.stubEnv("ALERTING_ENABLED", "true");
  vi.stubEnv("ALERT_EMAIL_TO", "owner@example.test");
  vi.stubEnv("RESEND_API_KEY", "re_test");
});
afterEach(() => vi.unstubAllEnvs());

const reuse = (userId: string) => ({ type: "oauth.refresh_reuse_detected", ts: ts(), requestId: "req-1", userId });
const subjects = () => h.send.mock.calls.map((c) => c[0].subject as string);

describe("immediate rules and cooldown", () => {
  it("emails once, then folds later events into the cooldown", async () => {
    await observe(reuse("u1"));
    await observe(reuse("u1"));
    await observe(reuse("u1"));
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(subjects()[0]).toBe("[JedForge CRITICAL] Refresh-token reuse detected");
    const state = await prisma.alertState.findUnique({ where: { rule_subject: { rule: "refresh_reuse", subject: "u1" } } });
    expect(state!.suppressedCount).toBe(2);
  });

  it("a different subject is a separate alert", async () => {
    await observe(reuse("u1"));
    await observe(reuse("u2"));
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it("the next email after the cooldown reports how many were swallowed", async () => {
    await observe(reuse("u1"));
    await observe(reuse("u1"));
    await prisma.alertState.update({
      where: { rule_subject: { rule: "refresh_reuse", subject: "u1" } },
      data: { lastSentAt: new Date(Date.now() - 61 * MIN) },
    });
    await observe(reuse("u1"));
    expect(h.send).toHaveBeenCalledTimes(2);
    // React inserts comment nodes between adjacent text nodes, so match loosely.
    expect(h.send.mock.calls[1][0].html).toMatch(/Suppressed since last alert:<\/strong>[\s\S]{0,30}1/);
  });

  it("admin_role_granted has no cooldown: two grants to the same user email twice", async () => {
    const grant = { type: "admin.role_granted", ts: ts(), userId: "admin1", targetUserId: "u9" };
    await observe(grant);
    await observe(grant);
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  // Review Focus 3, end to end.
  it("six racing observations of one event send exactly one email", async () => {
    await Promise.all(Array.from({ length: 6 }, () => observe(reuse("race"))));
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});

describe("threshold rules", () => {
  const fail = (i: number, ip = "198.51.100.1", email = `user${i}@victims.test`) => ({
    type: "auth.login_failed", ts: ts(), ip, requestId: `r${i}`, meta: { emailAttempted: email },
  });

  it("login_spray fires at the 10th DISTINCT account, not the 9th", async () => {
    for (let i = 0; i < 9; i++) await observe(fail(i));
    expect(h.send).not.toHaveBeenCalled();
    await observe(fail(9));
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(subjects()[0]).toContain("Login attempts across many accounts from one IP");
  });

  it("one account failing 30 times is not a spray", async () => {
    for (let i = 0; i < 30; i++) await observe(fail(i, "198.51.100.2", "same@victims.test"));
    expect(h.send).not.toHaveBeenCalled();
  });

  it("a different IP does not add to the count", async () => {
    for (let i = 0; i < 5; i++) await observe(fail(i, "198.51.100.3"));
    for (let i = 5; i < 10; i++) await observe(fail(i, "198.51.100.4"));
    expect(h.send).not.toHaveBeenCalled();
  });

  // Review Focus 5: the victim's address must reach neither the table nor the mailbox.
  it("never stores or emails the raw address", async () => {
    for (let i = 0; i < 10; i++) await observe(fail(i, "198.51.100.5", `secret${i}@victims.test`));
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0].html).not.toContain("victims.test");
    const rows = await prisma.alertEvent.findMany();
    expect(JSON.stringify(rows)).not.toContain("victims.test");
    expect(rows.every((r) => r.detail === null || /^[0-9a-f]{16}$/.test(r.detail))).toBe(true);
  });

  it("authz_probe fires at the 10th denial for one user", async () => {
    const denial = { type: "authz.denied_not_member", ts: ts(), userId: "prober" };
    for (let i = 0; i < 9; i++) await observe(denial);
    expect(h.send).not.toHaveBeenCalled();
    await observe(denial);
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("error_spike fires at the 20th error under one global subject", async () => {
    for (let i = 0; i < 19; i++) await observe({ type: i % 2 ? "app.error" : "prisma.error", ts: ts() });
    expect(h.send).not.toHaveBeenCalled();
    await observe({ type: "app.error", ts: ts() });
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("events outside the window do not count", async () => {
    for (let i = 0; i < 9; i++) await observe({ type: "authz.denied_not_member", ts: ts(), userId: "slow" });
    await prisma.alertEvent.updateMany({ where: { subject: "slow" }, data: { createdAt: new Date(Date.now() - 11 * MIN) } });
    await observe({ type: "authz.denied_not_member", ts: ts(), userId: "slow" });
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("global cap", () => {
  it("sends the cap's worth, then ONE cap notice, then only logs", async () => {
    for (let i = 0; i < GLOBAL_CAP_PER_HOUR; i++) await observe(reuse(`u${i}`));
    expect(h.send).toHaveBeenCalledTimes(GLOBAL_CAP_PER_HOUR);

    await observe(reuse("over1"));
    expect(h.send).toHaveBeenCalledTimes(GLOBAL_CAP_PER_HOUR + 1);
    expect(subjects()[GLOBAL_CAP_PER_HOUR]).toBe("[JedForge WARN] Alert cap reached");

    await observe(reuse("over2"));
    await observe(reuse("over3"));
    expect(h.send).toHaveBeenCalledTimes(GLOBAL_CAP_PER_HOUR + 1);
  });

  it("a cap notice does not itself count toward the cap", async () => {
    for (let i = 0; i < GLOBAL_CAP_PER_HOUR + 1; i++) await observe(reuse(`u${i}`));
    expect(await prisma.alertEvent.count({ where: { rule: "_sent" } })).toBe(GLOBAL_CAP_PER_HOUR);
  });
});

describe("send failure", () => {
  // Review Focus 4.
  it("does not count a failed send toward the cap and lets a retry through after ~5 minutes", async () => {
    h.send.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await observe(reuse("u1"));
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(await prisma.alertEvent.count({ where: { rule: "_sent" } })).toBe(0);

    await observe(reuse("u1")); // inside the retry gap
    expect(h.send).toHaveBeenCalledTimes(1);

    await prisma.alertState.update({
      where: { rule_subject: { rule: "refresh_reuse", subject: "u1" } },
      // The failed send left lastSentAt at ~55 min ago (cooldown 60 − retry 5). Age it past the
      // 60 min cooldown, i.e. the retry gap has elapsed.
      data: { lastSentAt: new Date(Date.now() - 61 * MIN) },
    });
    await observe(reuse("u1"));
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(await prisma.alertEvent.count({ where: { rule: "_sent" } })).toBe(1);
  });

  it("never rejects, even if the database write path throws", async () => {
    const spy = vi.spyOn(prisma.alertState, "updateMany").mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await observe(reuse("u1"));
      await expect(observe(reuse("u1"))).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
  });
});

describe("disabled and misconfigured", () => {
  it("does nothing, and touches no table, when ALERTING_ENABLED is unset", async () => {
    vi.stubEnv("ALERTING_ENABLED", "");
    await observe(reuse("u1"));
    expect(h.send).not.toHaveBeenCalled();
    expect(await prisma.alertState.count()).toBe(0);
  });

  it("warns once and sends nothing when enabled but ALERT_EMAIL_TO is missing", async () => {
    vi.stubEnv("ALERT_EMAIL_TO", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await observe(reuse("u1"));
      await observe(reuse("u2"));
      expect(h.send).not.toHaveBeenCalled();
      const alerting = warn.mock.calls.filter((c) => c[0] === "[alerting]");
      expect(alerting).toHaveLength(1);
      expect(String(alerting[0][2])).toContain("ALERT_EMAIL_TO");
    } finally {
      warn.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- src/integration/alerting-flow.itest.ts`
Expected: FAIL — `@/lib/alerting` not found.

- [ ] **Step 3: Implement `log.ts`**

```ts
/**
 * The alerting subsystem's own failure line (SECH-117).
 *
 * It must NOT go through securityEvent()/logError(): app.error and prisma.error feed the
 * error_spike rule, so an alerting failure that emitted one would feed itself. A plain
 * console line is the deliberate exception (allowlisted in console-sinks.test.ts). It carries
 * only a kind and a short string or error NAME — never a raw error, whose message can embed
 * data. In production the console patch (instrumentation.ts) still redacts it.
 */
const warned = new Set<string>();

export function alertingFailure(kind: string, detail?: unknown, opts: { once?: boolean } = {}): void {
  if (opts.once) {
    if (warned.has(kind)) return;
    warned.add(kind);
  }
  const text = typeof detail === "string" ? detail.slice(0, 200) : detail instanceof Error ? detail.name : "";
  console.warn("[alerting]", kind, text);
}

export function resetAlertingWarningsForTest(): void {
  warned.clear();
}
```

- [ ] **Step 4: Implement `index.ts`**

```ts
import { getAlertConfig } from "./config";
import { ALERT_RULES, GLOBAL_CAP_PER_HOUR, RETRY_AFTER_FAILURE_MS, type AlertRule, type AlertableRecord } from "./rules";
import { observationsFor, isTripped, type Observation } from "./evaluate";
import * as store from "./store";
import { sendAlertEmail, type AlertMessage } from "./deliver";
import { alertingFailure } from "./log";

const CAP_RULE = "_cap";
const CAP_COOLDOWN_MS = 60 * 60 * 1000;

export interface DispatchContext {
  to: string;
  drill: boolean;
  requestId?: string;
  count?: number;
}
export interface DispatchResult {
  sent: boolean;
  reason?: "cap" | "cooldown" | "send_failed";
  error?: string;
}

function messageFor(rule: AlertRule, subject: string, ctx: DispatchContext, suppressed: number): AlertMessage {
  return {
    rule: rule.id,
    title: rule.title,
    severity: rule.severity,
    summary: rule.summary,
    subject,
    count: ctx.count,
    windowMinutes: rule.threshold ? Math.round(rule.threshold.windowMs / 60_000) : undefined,
    suppressed,
    triggeredAt: new Date().toISOString(),
    requestId: ctx.requestId,
    drill: ctx.drill,
  };
}

/** One "cap reached" email per hour, itself cooldown-claimed so a flood cannot loop it. */
async function sendCapNotice(to: string): Promise<void> {
  const claim = await store.claimSend(CAP_RULE, "global", CAP_COOLDOWN_MS);
  if (!claim.claimed) return;
  const result = await sendAlertEmail(
    {
      rule: "alert_cap",
      title: "Alert cap reached",
      severity: "warn",
      summary: `${GLOBAL_CAP_PER_HOUR} alert emails were sent in the last hour, so further alerts are suppressed until that drops. The underlying events are still in Deploy Logs.`,
      subject: "global",
      suppressed: claim.suppressed,
      triggeredAt: new Date().toISOString(),
      drill: false,
    },
    to
  );
  if (!result.success) {
    await store.backdateClaim(CAP_RULE, "global", CAP_COOLDOWN_MS, RETRY_AFTER_FAILURE_MS);
    alertingFailure("cap_notice_failed", result.error);
  }
}

/**
 * Cap check → cooldown claim → send → ledger. Shared by observe() and the drill (Task 9),
 * so the drill exercises the real path. Drill traffic skips the cap and the ledger so it can
 * neither be blocked by nor consume real alert budget.
 */
export async function dispatch(rule: AlertRule, subject: string, ctx: DispatchContext): Promise<DispatchResult> {
  if (!ctx.drill && (await store.sentInLastHour()) >= GLOBAL_CAP_PER_HOUR) {
    await sendCapNotice(ctx.to);
    return { sent: false, reason: "cap" };
  }

  let suppressed = 0;
  if (rule.cooldownMs > 0) {
    const claim = await store.claimSend(rule.id, subject, rule.cooldownMs);
    if (!claim.claimed) return { sent: false, reason: "cooldown" };
    suppressed = claim.suppressed;
  }

  const result = await sendAlertEmail(messageFor(rule, subject, ctx, suppressed), ctx.to);
  if (!result.success) {
    // Otherwise a failed send would silence this rule for its whole cooldown.
    if (rule.cooldownMs > 0) await store.backdateClaim(rule.id, subject, rule.cooldownMs, RETRY_AFTER_FAILURE_MS);
    alertingFailure("send_failed", result.error);
    return { sent: false, reason: "send_failed", error: result.error };
  }
  if (!ctx.drill) await store.recordSent();
  return { sent: true };
}

async function handle(obs: Observation, record: AlertableRecord, to: string): Promise<void> {
  const { rule, subject, detail } = obs;
  let count: number | undefined;
  if (rule.threshold) {
    await store.recordObservation(rule.id, subject, detail);
    count = await store.countInWindow(rule.id, subject, rule.threshold.windowMs, !!rule.distinctBy);
    if (!isTripped(rule, count)) return;
  }
  await dispatch(rule, subject, { to, drill: false, requestId: record.requestId, count });
}

/**
 * Entry point from emit(). NEVER rejects: an alerting failure must not surface anywhere a
 * request can see it. Immediate rules write no observation row — they go straight to the
 * cooldown claim.
 */
export async function observe(record: AlertableRecord): Promise<void> {
  try {
    const cfg = getAlertConfig();
    if (!cfg.ready || !cfg.to) {
      // Enabled-but-unconfigured must not look like a quiet week.
      if (cfg.enabled) alertingFailure("misconfigured", `missing ${cfg.missing.join(", ")}`, { once: true });
      return;
    }
    for (const obs of observationsFor(record)) await handle(obs, record, cfg.to);
  } catch (err) {
    alertingFailure("observe_failed", err);
  }
}

export { ALERT_RULES };
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:integration -- src/integration/alerting-flow.itest.ts`
Expected: PASS. If the concurrency test (`six racing observations`) sends more than one email, stop: the claim in Task 4 is not atomic and nothing downstream is safe.

- [ ] **Step 6: Commit**

```bash
git add src/lib/alerting/log.ts src/lib/alerting/index.ts src/integration/alerting-flow.itest.ts
git diff --name-only --cached
git commit -m "Add observe(): thresholds, cooldown, global cap and failure retry (SECH-117)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Hook `emit()` and add the guard tests

**Files:**
- Modify: `src/lib/security-events.ts` (imports + `emit()`)
- Modify: `src/__tests__/console-sinks.test.ts` (allowlist)
- Test: `src/lib/__tests__/security-events-alerting.test.ts`, `src/__tests__/alerting-guards.test.ts`

**Interfaces:**
- Consumes: `alertingEnabled`, `ALERT_SOURCE_TYPES`, `alertingFailure`, `observe`.
- Produces: `emit()` calls `notifyAlerting(record)` after writing the log line.

- [ ] **Step 1: Write the failing tests**

`src/lib/__tests__/security-events-alerting.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ observe: vi.fn() }));
vi.mock("@/lib/alerting", () => ({ observe: h.observe }));

import { securityEvent } from "@/lib/security-events";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  h.observe.mockReset();
  h.observe.mockResolvedValue(undefined);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("ALERTING_ENABLED", "true");
});
afterEach(() => {
  warn.mockRestore();
  vi.unstubAllEnvs();
});

const lines = () => warn.mock.calls.filter((c) => typeof c[0] === "string" && c[0].startsWith("{")).map((c) => JSON.parse(c[0] as string));
const flush = () => new Promise((r) => setTimeout(r, 20));

describe("emit() → alerting hook (SECH-117)", () => {
  it("hands a source-type record to observe() after writing the log line", async () => {
    securityEvent("oauth.refresh_reuse_detected", { userId: "u1", meta: { clientId: "c1" } });
    await vi.waitFor(() => expect(h.observe).toHaveBeenCalledTimes(1));
    expect(h.observe.mock.calls[0][0]).toMatchObject({ type: "oauth.refresh_reuse_detected", userId: "u1", severity: "critical" });
    expect(lines()).toHaveLength(1);
  });

  it("does not call observe() for a type no rule listens to", async () => {
    securityEvent("csp.violation");
    securityEvent("admin.action", { userId: "u1" });
    await flush();
    expect(h.observe).not.toHaveBeenCalled();
  });

  it("does not call observe() while alerting is off", async () => {
    vi.stubEnv("ALERTING_ENABLED", "");
    securityEvent("oauth.refresh_reuse_detected", { userId: "u1" });
    await flush();
    expect(h.observe).not.toHaveBeenCalled();
  });

  // Review Focus 1: the log line and the caller are unaffected by ANY alerting failure.
  it("writes the identical log line whether observe() resolves, rejects or throws", async () => {
    const run = async (impl: () => unknown) => {
      warn.mockClear();
      h.observe.mockImplementation(impl as () => Promise<void>);
      securityEvent("oauth.refresh_reuse_detected", { requestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", userId: "u1" });
      await flush();
      const [rec] = lines();
      return { ...rec, ts: "T" };
    };
    const ok = await run(async () => {});
    const rejected = await run(async () => { throw new Error("boom"); });
    const threw = await run(() => { throw new Error("sync boom"); });
    expect(rejected).toEqual(ok);
    expect(threw).toEqual(ok);
  });

  it("does not throw or leave an unhandled rejection when observe() rejects, and reports it", async () => {
    h.observe.mockRejectedValue(new Error("boom"));
    expect(() => securityEvent("oauth.refresh_reuse_detected", { userId: "u1" })).not.toThrow();
    await flush();
    expect(warn.mock.calls.some((c) => c[0] === "[alerting]" && c[1] === "observe_failed")).toBe(true);
  });
});
```

`src/__tests__/alerting-guards.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SECURITY_EVENT_SEVERITY, SECURITY_EVENT_TYPES } from "@/lib/security-events";
import { ALERT_RULES } from "@/lib/alerting/rules";

/**
 * SECH-117 guards. A rule that listens to a type that is not in the catalog can never fire,
 * and a critical event nobody alerts on turns "no attack" and "no alert" into the same silence.
 */

const ALERTING_DIR = path.join(__dirname, "..", "lib", "alerting");
const files = fs.readdirSync(ALERTING_DIR).filter((f) => f.endsWith(".ts")).map((f) => ({
  name: f,
  text: fs.readFileSync(path.join(ALERTING_DIR, f), "utf8"),
}));

/** Critical types deliberately NOT alerted on. Empty on purpose — add a reason if that changes. */
const UNALERTED_CRITICAL: Record<string, string> = {};

describe("alert rules vs the security-event catalog", () => {
  it("every rule source is a real catalog type", () => {
    for (const rule of ALERT_RULES) {
      for (const source of rule.sources) {
        expect(SECURITY_EVENT_TYPES as readonly string[], `${rule.id} listens to unknown type ${source}`).toContain(source);
      }
    }
  });

  it("rule ids are unique", () => {
    expect(new Set(ALERT_RULES.map((r) => r.id)).size).toBe(ALERT_RULES.length);
  });

  it("every critical event type is covered by a rule or has a written exception", () => {
    const covered = new Set(ALERT_RULES.flatMap((r) => r.sources));
    const uncovered = SECURITY_EVENT_TYPES.filter(
      (t) => SECURITY_EVENT_SEVERITY[t] === "critical" && !covered.has(t) && !(t in UNALERTED_CRITICAL)
    );
    expect(uncovered, "add an alert rule (rules.ts) or a reasoned entry in UNALERTED_CRITICAL").toEqual([]);
  });
});

describe("alerting subsystem structure", () => {
  it("scanned the subsystem", () => {
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(["rules.ts", "config.ts", "store.ts", "index.ts", "deliver.ts", "log.ts", "evaluate.ts"]));
  });

  // app.error / prisma.error feed error_spike: alerting emitting one would feed itself.
  it("no alerting module imports security-events (loop guard)", () => {
    const offenders = files.filter((f) => /from\s+["'][^"']*security-events["']/.test(f.text)).map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  // security-events.ts loads these two on EVERY emit; they must not pull Prisma or Resend in.
  it("rules.ts and config.ts have no imports at all", () => {
    for (const name of ["rules.ts", "config.ts"]) {
      const text = files.find((f) => f.name === name)!.text;
      expect(/^\s*import\s/m.test(text), `${name} must stay import-free`).toBe(false);
    }
  });

  it("only store.ts touches Prisma", () => {
    const offenders = files.filter((f) => f.name !== "store.ts" && /@\/lib\/prisma|@prisma\/client/.test(f.text)).map((f) => f.name);
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/__tests__/security-events-alerting.test.ts src/__tests__/alerting-guards.test.ts`
Expected: FAIL — `observe` is never called (the hook does not exist); the guard tests may pass or fail depending on file presence.

- [ ] **Step 3: Add the hook to `emit()`**

In `src/lib/security-events.ts`, add imports below the existing ones:

```ts
import { ALERT_SOURCE_TYPES, type AlertableRecord } from "./alerting/rules";
import { alertingEnabled } from "./alerting/config";
import { alertingFailure } from "./alerting/log";
```

Add this function above `emit()` and call `notifyAlerting(record);` as the **last line** of `emit()` (after `console.warn(line);`):

```ts
/**
 * SECH-117: hand the record to alerting. Detached and never awaited, so it can neither slow
 * nor fail the request that emitted it.
 *
 * The import is dynamic on purpose: alerting reaches Prisma, and prisma.ts imports THIS
 * module, so a static import would be a cycle. It also means a deployment with alerting off
 * (the default) never loads Resend or the store at all. Only rules.ts and config.ts — both
 * import-free — are loaded statically.
 */
function notifyAlerting(record: Record<string, unknown>): void {
  try {
    if (!alertingEnabled() || !ALERT_SOURCE_TYPES.has(String(record.type))) return;
    void import("./alerting")
      .then((m) => m.observe(record as unknown as AlertableRecord))
      .catch((err) => alertingFailure("observe_failed", err));
  } catch (err) {
    alertingFailure("notify_failed", err);
  }
}
```

Update the file's header comment: replace "SECH-117 adds a sink there" with "SECH-117's `notifyAlerting()` runs there".

- [ ] **Step 4: Allowlist the alerting log line**

In `src/__tests__/console-sinks.test.ts`, add to `ALLOWED`:

```ts
  ["lib/alerting/log.ts", "alerting's own failure line — must not use securityEvent, which feeds error_spike (SECH-117)"],
```

- [ ] **Step 5: Run to verify it passes, plus the neighbouring guards**

Run:
```bash
npx vitest run src/lib/__tests__/security-events-alerting.test.ts src/__tests__/alerting-guards.test.ts src/__tests__/console-sinks.test.ts src/__tests__/security-logging-sinks.test.ts src/lib/__tests__/security-events.test.ts src/__tests__/security-event-wiring.test.ts
```
Expected: PASS. `security-logging-sinks` must stay green: `log.ts` prints a plain `console.warn("[alerting]", …)`, not `console.warn(JSON.stringify(…))`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/security-events.ts src/__tests__/console-sinks.test.ts src/lib/__tests__/security-events-alerting.test.ts src/__tests__/alerting-guards.test.ts
git diff --name-only --cached
git commit -m "Hook emit() to alerting behind a lazy import, with guard tests (SECH-117)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Phase 1 docs, full verification, PR, deploy

**Files:**
- Create: `.context-docs/alerting.md`
- Modify: `.context-docs/security-events.md`, `CLAUDE.md`, `.env.example`

- [ ] **Step 1: Write `.context-docs/alerting.md`**

Contents (write these sections, using the spec as the source; keep it a reference, not a narrative):
1. **What it is** — one paragraph: `emit()` → `notifyAlerting()` → lazy `observe()`; Postgres state; Resend; off by default.
2. **Rules table** — copy the spec's table verbatim (ids, sources, subject, threshold, cooldown) plus the rationale bullets for `login_spray` (failures not throttles) and `authz_probe` (excludes `denied_role`).
3. **Tables** — `AlertEvent` (incl. the `_sent` ledger rows, `detail` hash prefix) and `AlertState`; pruning (24 h / 7 d on ~1% of writes).
4. **Flood control** — per-subject cooldown via the single-statement claim (why it is atomic), the soft 10/hour cap and the once-per-hour cap notice, failed-send backdating.
5. **Config** — the three env vars; enabled-but-missing behaviour; `ALERTING_ENABLED` is exactly `"true"`.
6. **Never** — never call `securityEvent`/`logError` from `src/lib/alerting/`; never import Prisma outside `store.ts`; `rules.ts`/`config.ts` stay import-free; never put an address/token in `subject` or an email.
7. **Adding a rule** — add to `ALERT_RULES`; ensure the source call site sets the field the rule groups by; the guard tests (`alerting-guards.test.ts`) fail on an unknown source or an unalerted critical type; add a case to `alerting-rules.test.ts`.
8. **Site-down** — not in the app; external monitor on `https://www.jedforge.com/login` (set up by Jamie).
9. **Drill** — placeholder line: "Added in Phase 2; see the drill section once merged." (Task 11 replaces it.)

- [ ] **Step 2: Update `.context-docs/security-events.md`**

- In the catalog table add: `| \`admin.role_granted\` | critical | \`admin/actions.ts\` (×2) |`.
- In "The `emit()` seam", replace "SECH-115 inserts redaction and SECH-117 adds a sink" with: "SECH-115 redacts `meta` here; SECH-117's `notifyAlerting()` runs after the log line is written — see `alerting.md`."
- In "Denial classification", after "Thresholding stays out of the emitter and belongs in SECH-117." append: "It now lives there: `authz_probe` in `alerting/rules.ts`."

- [ ] **Step 3: Update `.env.example` and `CLAUDE.md`**

Append to `.env.example`:

```
# Owner alerting (SECH-117) — off unless ALERTING_ENABLED is exactly "true"
ALERTING_ENABLED=
# Where security alerts are emailed. Set in Railway, never commit a real address.
ALERT_EMAIL_TO=
# RESEND_API_KEY (already used for invites) is also required for alerts.
```

In `CLAUDE.md` (keep it lean, per the size-discipline memory): add one line to the "Reference docs" list —
`- .context-docs/alerting.md — owner alerting (SECH-117): rules/thresholds, Postgres cooldown claim, global cap, config, never-list, how to add a rule, external site-down monitor`
— and one bullet under "Security constraints": **"Owner alerting never emits security events (SECH-117)"** — one sentence: no file under `src/lib/alerting/` may import `security-events` (`app.error`/`prisma.error` feed `error_spike`, so it would feed itself); failures use `alertingFailure()`; details in `alerting.md`.

- [ ] **Step 4: Full verification (evidence before claims)**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run test:integration
git status --short
```
Expected: lint 0 errors and no new warnings; tsc clean; unit and integration suites fully green. If `npx tsc` complains about `.next/types`, apply the CLAUDE.md fix (`rm -rf .next/types`). If `tenancy.test.ts` (or another hand-written Prisma mock) fails, follow `.context-docs/testing-notes.md`. Do not proceed on any red.

- [ ] **Step 5: Commit docs, push, open the PR**

```bash
git add .context-docs/alerting.md .context-docs/security-events.md CLAUDE.md .env.example
git diff --name-only --cached
git commit -m "docs: owner alerting reference, env vars and CLAUDE.md pointer (SECH-117)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -u origin HEAD
cat .github/pull_request_template.md
gh pr create --base main --title "Owner alerting engine, rules and email delivery (SECH-117 Phase 1)" --body-file <(printf '%s\n' "…fill the template from .github/pull_request_template.md…" "" "🤖 Generated with [Claude Code](https://claude.com/claude-code)")
gh pr checks --watch
```
Fill the security checklist from the template honestly (touches admin actions and the emit path; new tables; no new external origin; alerting is off by default). Required checks: `Verify`, `Integration (cross-tenant)`, `Secret scan`, `Dependency audit`. Then `gh pr merge --squash --delete-branch`. If refused as "not up to date", `git merge origin/main`, push, wait for CI again.

- [ ] **Step 6: Post-merge — monitor CI and confirm the migration applied**

```bash
until gh run list --repo jedmond1971/taskforge --branch main --limit 1 2>&1 | grep -qE "completed|failure|success"; do sleep 5; done
gh run list --repo jedmond1971/taskforge --branch main --limit 1
```
Then confirm the deploy reached production with the `deployments(...)` GraphQL query (recipe in `.context-docs/local-dev-tooling.md`): `meta.commitHash` equals the merge commit and `status: SUCCESS` — that also proves `prisma migrate deploy` ran the new migration. Do **not** run the blocked `variables(...)` or `environmentLogs` queries.

Alerting is dormant at this point (`ALERTING_ENABLED` unset), so production behaviour is unchanged. Comment on SECH-117 as Maximus (Python heredoc, production v1 API) summarising Phase 1 and stating it is dormant until Jamie sets the env vars.

---

# PHASE 2 — the delivery drill (PR 2, new branch from updated `main`)

```bash
git switch main && git pull --ff-only && git switch -c sech-117-alert-drill
```

### Task 9: Drill core, rate limit and admin action

**Files:**
- Modify: `src/lib/alerting/store.ts` (add `deleteDrillRows`)
- Modify: `src/lib/alerting/index.ts` (add `runDrill`, types)
- Modify: `src/lib/rate-limit.ts` (`LIMITS`)
- Modify: `src/app/(dashboard)/admin/actions.ts` (`adminSendAlertDrill`)
- Modify: `.context-docs/authz-matrix.md` (row under `### \`(dashboard)/admin/actions.ts\``)
- Modify: `src/integration/admin-actions.itest.ts` (`everyAdminAction()`)
- Test: `src/integration/alerting-drill.itest.ts`

**Interfaces:**
- Consumes: `dispatch`, `store.*`, `ALERT_RULES`, `getAlertConfig` (earlier tasks).
- Produces:
  ```ts
  export interface DrillRuleResult { rule: string; sent: boolean; reason?: string; error?: string }
  export interface DrillResult { enabled: boolean; configured: boolean; missing: string[]; results: DrillRuleResult[] }
  export function runDrill(): Promise<DrillResult>
  // admin/actions.ts
  export async function adminSendAlertDrill(): Promise<{ success: true; result: DrillResult } | { success: false; error: string }>
  ```

- [ ] **Step 1: Write the failing integration test**

`src/integration/alerting-drill.itest.ts`:

```ts
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: h.send }; } }));

import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs, actAsNobody } from "./session";
import * as adminActions from "@/app/(dashboard)/admin/actions";
import { ALERT_RULES } from "@/lib/alerting/rules";

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => { await destroyWorld(w); });

beforeEach(async () => {
  await prisma.alertEvent.deleteMany();
  await prisma.alertState.deleteMany();
  h.send.mockReset();
  h.send.mockResolvedValue({ data: { id: "e" }, error: null });
  vi.stubEnv("ALERTING_ENABLED", "true");
  vi.stubEnv("ALERT_EMAIL_TO", "owner@example.test");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  actAs(w.users.aAdmin);
});
afterEach(() => vi.unstubAllEnvs());

describe("adminSendAlertDrill", () => {
  it("sends one [DRILL] email per rule through the real path and reports each", async () => {
    const res = await adminActions.adminSendAlertDrill();
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.result.configured).toBe(true);
    expect(res.result.results.map((r) => r.rule).sort()).toEqual(ALERT_RULES.map((r) => r.id).sort());
    expect(res.result.results.every((r) => r.sent)).toBe(true);
    expect(h.send).toHaveBeenCalledTimes(ALERT_RULES.length);
    for (const [payload] of h.send.mock.calls) {
      expect(payload.subject.startsWith("[DRILL] ")).toBe(true);
      expect(payload.html).toContain("DRILL");
    }
  });

  it("leaves nothing behind and never touches real budget or counters", async () => {
    await adminActions.adminSendAlertDrill();
    expect(await prisma.alertEvent.count()).toBe(0); // synthetic observations removed, no _sent ledger rows
    expect(await prisma.alertState.count()).toBe(0);
  });

  it("is exempt from the global cap", async () => {
    for (let i = 0; i < 12; i++) await prisma.alertEvent.create({ data: { rule: "_sent", subject: "global" } });
    const res = await adminActions.adminSendAlertDrill();
    expect(res.success && res.result.results.every((r) => r.sent)).toBe(true);
  });

  it("is rate limited to one drill per 10 minutes", async () => {
    expect((await adminActions.adminSendAlertDrill()).success).toBe(true);
    const second = await adminActions.adminSendAlertDrill();
    expect(second).toMatchObject({ success: false, error: expect.stringMatching(/too many attempts/i) });
    expect(h.send).toHaveBeenCalledTimes(ALERT_RULES.length); // the second drill sent nothing
  });

  // Review Focus 6: enabled-but-misconfigured is reported, not silent.
  it("reports what is missing instead of sending when alerting is not configured", async () => {
    vi.stubEnv("ALERT_EMAIL_TO", "");
    const res = await adminActions.adminSendAlertDrill();
    expect(res).toMatchObject({ success: true, result: { enabled: true, configured: false, missing: ["ALERT_EMAIL_TO"], results: [] } });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("reports a provider failure per rule", async () => {
    h.send.mockResolvedValue({ data: null, error: { message: "domain not verified" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await adminActions.adminSendAlertDrill();
      expect(res.success && res.result.results.every((r) => !r.sent && r.reason === "send_failed" && r.error === "domain not verified")).toBe(true);
    } finally { warn.mockRestore(); }
  });

  it("is refused for a non-admin and for no session", async () => {
    actAs(w.users.aOwner);
    await expect(adminActions.adminSendAlertDrill()).rejects.toThrow(/unauthorized|forbidden/i);
    actAsNobody();
    await expect(adminActions.adminSendAlertDrill()).rejects.toThrow(/unauthorized|forbidden/i);
    expect(h.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- src/integration/alerting-drill.itest.ts`
Expected: FAIL — `adminSendAlertDrill` is not a function.

- [ ] **Step 3: Add `deleteDrillRows` to `store.ts`**

```ts
/** Remove a drill run's synthetic observations and cooldown rows. Real subjects never start with "drill:". */
export async function deleteDrillRows(subject: string): Promise<void> {
  await prisma.alertEvent.deleteMany({ where: { subject } });
  await prisma.alertState.deleteMany({ where: { subject } });
}
```

- [ ] **Step 4: Add `runDrill` to `index.ts`**

Add `import { randomUUID } from "node:crypto";` and:

```ts
export interface DrillRuleResult {
  rule: string;
  sent: boolean;
  reason?: string;
  error?: string;
}
export interface DrillResult {
  enabled: boolean;
  configured: boolean;
  missing: string[];
  results: DrillRuleResult[];
}

/**
 * Prove the delivery path (SECH-117 definition of done; stands in for staging until SECH-110).
 *
 * Per rule it injects threshold-many synthetic observations under a `drill:<runId>` subject,
 * then runs the REAL count → dispatch path, so counting, cooldown, rendering and Resend are
 * all exercised. Real counters are untouched (different subject), the cap is skipped, and the
 * synthetic rows are removed afterwards.
 */
export async function runDrill(): Promise<DrillResult> {
  const cfg = getAlertConfig();
  if (!cfg.ready || !cfg.to) return { enabled: cfg.enabled, configured: false, missing: cfg.missing, results: [] };

  const subject = `drill:${randomUUID().slice(0, 8)}`;
  const results: DrillRuleResult[] = [];
  try {
    for (const rule of ALERT_RULES) {
      if (rule.threshold) {
        for (let i = 0; i < rule.threshold.count; i++) {
          await store.recordObservation(rule.id, subject, rule.distinctBy ? `drill-${i}` : undefined);
        }
        const count = await store.countInWindow(rule.id, subject, rule.threshold.windowMs, !!rule.distinctBy);
        if (!isTripped(rule, count)) {
          results.push({ rule: rule.id, sent: false, reason: "threshold_not_reached" });
          continue;
        }
      }
      const r = await dispatch(rule, subject, { to: cfg.to, drill: true, count: rule.threshold?.count });
      results.push({ rule: rule.id, sent: r.sent, reason: r.reason, error: r.error });
    }
  } finally {
    await store.deleteDrillRows(subject).catch((err) => alertingFailure("drill_cleanup_failed", err));
  }
  return { enabled: cfg.enabled, configured: true, missing: [], results };
}
```

- [ ] **Step 5: Add the limit and the action**

In `src/lib/rate-limit.ts` `LIMITS`:

```ts
  // SECH-117: one delivery drill per admin per 10 minutes. Each drill sends one email per rule.
  alertDrillPerUser: { maxAttempts: 1, windowMs: 10 * MINUTE },
```

In `src/app/(dashboard)/admin/actions.ts` (add `runDrill` / `DrillResult` imports from `@/lib/alerting`, and `consumeRateLimit, LIMITS, tooManyAttemptsMessage` from `@/lib/rate-limit` if not already imported):

```ts
// SECH-117: send one synthetic alert per rule through the real delivery path. Admin-only.
export async function adminSendAlertDrill(): Promise<
  { success: true; result: DrillResult } | { success: false; error: string }
> {
  const { userId } = await requireAdmin();
  const limit = await consumeRateLimit(`alert-drill:${userId}`, LIMITS.alertDrillPerUser);
  if (!limit.allowed) return { success: false, error: tooManyAttemptsMessage(limit.retryAfterSeconds) };
  return { success: true, result: await runDrill() };
}
```

- [ ] **Step 6: Register the action in the matrix and the admin coverage test**

`.context-docs/authz-matrix.md`, add under the `(dashboard)/admin/actions.ts` table:

```
| `adminSendAlertDrill` | `requireAdmin()` (permissions.ts) | none — sends synthetic alerts to the configured owner address only | platform ADMIN; rate-limited 1 per 10 min per admin (`alertDrillPerUser`) |
```

`src/integration/admin-actions.itest.ts` `everyAdminAction()`, before the closing `];`:

```ts
    ["adminSendAlertDrill", () => adminActions.adminSendAlertDrill()],
```

- [ ] **Step 7: Run to verify it passes**

Run:
```bash
npm run test:integration -- src/integration/alerting-drill.itest.ts src/integration/admin-actions.itest.ts
npx vitest run src/__tests__/authz-matrix.test.ts src/lib/__tests__/rate-limit.test.ts src/__tests__/alerting-guards.test.ts
```
Expected: PASS. (`alerting-guards` still passes: `runDrill` uses `store` and `alertingFailure`, nothing forbidden.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/alerting/store.ts src/lib/alerting/index.ts src/lib/rate-limit.ts "src/app/(dashboard)/admin/actions.ts" .context-docs/authz-matrix.md src/integration/admin-actions.itest.ts src/integration/alerting-drill.itest.ts
git diff --name-only --cached
git commit -m "Add an admin-only alert delivery drill (SECH-117)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Drill UI

**Files:**
- Create: `src/app/(dashboard)/admin/alerting/page.tsx`, `src/app/(dashboard)/admin/alerting/AlertDrillClient.tsx`
- Modify: `src/app/(dashboard)/admin/page.tsx` (add a card)

**Interfaces:**
- Consumes: `getAlertConfig()` (server-side, no secrets exposed), `adminSendAlertDrill`, `DrillResult`.

- [ ] **Step 1: Confirm the icon exists**

Run: `node -e "const l=require('lucide-react'); console.log(!!l.BellRing, !!l.Bell)"`
Expected: `true true` (use `Bell` if `BellRing` is absent — see the CLAUDE.md lucide naming gotcha).

- [ ] **Step 2: Implement the page (server component)**

`src/app/(dashboard)/admin/alerting/page.tsx`:

```tsx
import { requireUser } from "@/lib/auth";
import { getAlertConfig } from "@/lib/alerting/config";
import { AlertDrillClient } from "./AlertDrillClient";

export default async function AdminAlertingPage() {
  await requireUser();
  const cfg = getAlertConfig();
  // Booleans only: the recipient address and API key never reach the client.
  return <AlertDrillClient enabled={cfg.enabled} hasRecipient={!cfg.missing.includes("ALERT_EMAIL_TO")} hasResendKey={!cfg.missing.includes("RESEND_API_KEY")} />;
}
```

- [ ] **Step 3: Implement the client component**

`src/app/(dashboard)/admin/alerting/AlertDrillClient.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminSendAlertDrill } from "../actions";
import type { DrillResult } from "@/lib/alerting";

const card = "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm dark:shadow-none";

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{ok ? "✓" : "✗"}</span>
      <span className="text-zinc-700 dark:text-zinc-300">{label}</span>
    </li>
  );
}

export function AlertDrillClient({ enabled, hasRecipient, hasResendKey }: { enabled: boolean; hasRecipient: boolean; hasResendKey: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<DrillResult | null>(null);

  function run() {
    startTransition(async () => {
      try {
        const res = await adminSendAlertDrill();
        if (!res.success) { toast.error(res.error); return; }
        setResult(res.result);
        if (!res.result.configured) toast.error("Alerting is not configured — nothing was sent");
        else if (res.result.results.every((r) => r.sent)) toast.success("Test alerts sent — check your inbox");
        else toast.error("Some test alerts failed to send");
      } catch {
        toast.error("Something went wrong");
      }
    });
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className={card}>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Owner alerting</h2>
        <ul className="space-y-1 mb-4">
          <Status ok={enabled} label="ALERTING_ENABLED is true" />
          <Status ok={hasRecipient} label="ALERT_EMAIL_TO is set" />
          <Status ok={hasResendKey} label="RESEND_API_KEY is set" />
        </ul>
        <p className="text-sm text-zinc-500 mb-4">
          Sends one clearly-labelled [DRILL] email per alert rule through the real delivery path. It does not touch real counters
          or the hourly cap. One drill per 10 minutes. Site-down alerts come from the external uptime monitor, not from here.
        </p>
        <Button onClick={run} disabled={pending}>{pending ? "Sending…" : "Send test alerts"}</Button>
      </div>

      {result && (
        <div className={card}>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Last drill</h3>
          {!result.configured ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              Not sent. {result.enabled ? `Missing: ${result.missing.join(", ")}.` : "ALERTING_ENABLED is not \"true\"."}
            </p>
          ) : (
            <ul className="space-y-1">
              {result.results.map((r) => (
                <li key={r.rule} className="text-sm flex gap-2">
                  <span className={r.sent ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{r.sent ? "sent" : "failed"}</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{r.rule}</span>
                  {!r.sent && <span className="text-zinc-500">({r.error ?? r.reason})</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the card to `/admin`**

In `src/app/(dashboard)/admin/page.tsx` import `BellRing` from `lucide-react` (add to the existing import) and append to `sections`:

```tsx
    {
      href: "/admin/alerting",
      title: "Owner Alerting",
      description: "Check alert configuration and send a test alert for every rule.",
      icon: BellRing,
      stat: "Delivery drill",
    },
```
The grid is `xl:grid-cols-5`; with six cards change it to `xl:grid-cols-3` so nothing wraps awkwardly.

- [ ] **Step 5: Verify in the browser (real UI, fake key so no real mail is sent)**

Check `.claude/launch.json` for the dev server name (create the entry per the tool docs if absent). Start the server with alerting env set to a fake key so the drill path runs end to end but Resend rejects it:

```bash
ALERTING_ENABLED=true ALERT_EMAIL_TO=owner@example.test RESEND_API_KEY=re_fake_local_key
```
Then `preview_start`, sign in as `admin@jedforge.dev` / `password123`, open `/admin/alerting`. Verify: three green ticks; "Send test alerts" shows a "failed" line per rule with the provider reason (Resend rejects the fake key), and a second click within 10 minutes shows the rate-limit toast. Then restart without the env vars and confirm the page shows three red crosses and "Not sent. ALERTING_ENABLED is not "true"." Check `read_console_messages` for errors and take a screenshot as evidence. Also confirm a non-admin (`member@jedforge.dev`) is redirected away from `/admin/alerting` by the admin layout.

- [ ] **Step 6: Lint, type-check, commit**

```bash
npm run lint && npx tsc --noEmit
git add "src/app/(dashboard)/admin/alerting" "src/app/(dashboard)/admin/page.tsx"
git diff --name-only --cached
git commit -m "Add the admin alerting page with the delivery drill (SECH-117)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
(`session-invalidation.test.ts` requires the new `page.tsx` to call `requireUser()` — it does.)

---

### Task 11: Phase 2 docs, verification, PR, and the handoff to Jamie

**Files:**
- Modify: `.context-docs/alerting.md` (replace the drill placeholder), `.context-docs/rate-limiting.md`, `CLAUDE.md` (only if a durable fact was learned)

- [ ] **Step 1: Docs**

- `.context-docs/alerting.md` → "Drill": what it does (synthetic observations under `drill:<runId>`, real count → dispatch path, cap-exempt, rows deleted, `[DRILL]` subject), where it lives (`/admin/alerting`, `adminSendAlertDrill`), the 1-per-10-minutes limit, and that it substitutes for staging until SECH-110 (**re-run it there once staging exists**).
- `.context-docs/rate-limiting.md` → add a row: `adminSendAlertDrill` | `alert-drill:<userId>` | attempts | 1 / 10 min | "Too many attempts…".

- [ ] **Step 2: Full verification and PR**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run test:integration
git add .context-docs/alerting.md .context-docs/rate-limiting.md
git diff --name-only --cached
git commit -m "docs: alert drill and its rate limit (SECH-117)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -u origin HEAD
gh pr create --base main --title "Alert delivery drill (SECH-117 Phase 2)" --body-file <(…PR template filled…; printf '\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n')
gh pr checks --watch
gh pr merge --squash --delete-branch
```
Then the post-merge CI monitor loop and the `deployments(...)` commit-hash check, exactly as in Task 8 Step 6.

- [ ] **Step 3: Hand off to Jamie (these steps cannot be done by Claude)**

Tell Jamie, in this order:
1. In Railway set `ALERT_EMAIL_TO=<their address>` and `ALERTING_ENABLED=true` (`RESEND_API_KEY` already exists). Redeploy happens automatically.
2. Open `https://www.jedforge.com/admin/alerting`, confirm three ticks, click **Send test alerts**, and check the inbox for six `[DRILL]` emails. Screenshot the inbox (timestamps visible).
3. Create the external uptime check (UptimeRobot or Better Stack, free tier) on `https://www.jedforge.com/login`, alerting to the same address, and use its "send test notification". Screenshot it.
4. Send the two screenshots back so they can be attached to SECH-117.

- [ ] **Step 4: Close-out (after Jamie confirms delivery)**

- Post the fix-summary comment on SECH-117 **as Maximus via the production v1 API** (Python heredoc; HTML body): what shipped in both PRs, the `[DRILL]` timestamps and the screenshots' description, and the explicit note that the drill ran in **production** (not staging) because SECH-110 is unprovisioned, so it should be re-run when staging exists. Follow the PR-template-mirrored checklist in `CLAUDE_API.md`.
- Set SECH-117 to Done via `PATCH /api/v1/issues/SECH-117` (`statusId: "Done"`) only after Jamie confirms the inbox evidence.
- Follow-up issue (JFR/SECH per convention, Backlog, LOW): re-run the drill in staging once SECH-110 lands.
- End-of-session: update `CLAUDE.md` only with durable facts learned (e.g. anything surprising about the claim SQL or Resend), update the memory file `project_sech_status.md` (117 done, 114/115 done, remaining Phase 4: 113/116/118/119), and remove the now-obsolete "open items" mentions if any.

---

## Self-review (against the spec)

**Spec coverage**
- Pipeline / detached / never throws / lazy import → Tasks 6, 7. ✔ (Lazy import is an addition forced by the `prisma.ts` ↔ `security-events.ts` cycle; noted in Task 7.)
- Loop guard, stderr allowlist → Tasks 6, 7. ✔
- Only rule-relevant types touch the DB → `ALERT_SOURCE_TYPES` gate (Task 7) + test. ✔
- Tables, `detail` hash, pruning, immediate rules write no row → Tasks 2, 3, 4, 6. ✔
- Rules table with exact thresholds → Task 3 (`spec table` test pins them). ✔
- `admin.role_granted` at both sites + checklist → Task 1. ✔
- Cooldown atomic claim returning prior `suppressedCount` → Task 4. ✔
- Global cap 10/h, one cap notice, drill exempt → Tasks 6, 9. ✔
- Delivery (Resend, From, To env, body contents, render-before-send, lazy client) → Task 5. ✔
- Config + misconfigured reporting → Tasks 3, 6, 9, 10. ✔
- Failure handling (DB down, Resend error backdate, template error) → Task 6. ✔
- Drill (per-rule synthetic, `[DRILL]`, cap-exempt, rate-limited, matrix/admin-action/itest entries) → Tasks 9, 10. ✔
- Tests (unit, integration, guard incl. critical-coverage, loop, console allowlist) → Tasks 3–9. ✔
- Rollout (two PRs, dormant, migration check, Jamie's env + drill + uptime monitor, Maximus comment, deviation note) → Tasks 8, 11. ✔

**Deliberate deviations from the spec's file list:** `evaluate.ts` holds pure matching/hashing as proposed; `log.ts` is added (the spec said "one allowlisted stderr write" — this is its home); `runDrill` lives in `index.ts`. The spec's "requestId(s)" became a single `requestId` of the tripping event (threshold rules don't store request ids).

**Placeholder scan:** the only `…` in the plan are the two `gh pr create --body-file` invocations, whose body is the repo's PR template to be filled in at execution time (Task 8 Step 5 says to `cat` it first); the docs in Task 8 Step 1 are specified section by section from the spec. No TBDs.

**Type consistency:** `AlertMessage` (Task 5) is what `messageFor` builds (Task 6) and what `SecurityAlertEmail` takes; `DispatchContext`/`DispatchResult` (Task 6) are what `runDrill` consumes (Task 9); `claimSend` returns `{ claimed, suppressed }` everywhere; `backdateClaim(rule, subject, cooldownMs, retryMs)` is called with `RETRY_AFTER_FAILURE_MS` in both places; `alertingFailure(kind, detail?, opts?)` matches its uses; `LIMITS.alertDrillPerUser` is used with `consumeRateLimit(key, config)`.
