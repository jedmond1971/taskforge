# SECH-114 Security-Event Logger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every ad-hoc security log in the app with one `securityEvent()` helper emitting single-line JSON on a stable schema, correlated by a request ID generated or propagated in middleware.

**Architecture:** A zero-dependency `request-id` module supplies generation and strict validation (usable from Edge middleware). A `security-events` module owns a closed catalog of event types, a severity map keyed by type, and a single private `emit()` seam through which every event passes — the insertion point for SECH-115 redaction and SECH-117 sinks. Call sites pass structured fields; they never format a log line.

**Tech Stack:** TypeScript, Next.js 16 (App Router, Edge middleware), Vitest, Prisma. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-sech-114-security-event-logger-design.md`

## Global Constraints

- **No new runtime dependencies.** Anything added would have to clear the pinning rule (`src/__tests__/dependency-pinning.test.ts`) and the `Dependency audit` CI gate. This ticket adds none.
- **Edge compatibility.** `src/middleware.ts` runs on the Edge runtime. Use the **global** `crypto.randomUUID()`, never `import { randomUUID } from "crypto"` — the node builtin is not available there. `src/lib/request-id.ts` must import nothing.
- **`emit()` is the only place a security event is written.** No call site calls `console.*` for a security signal.
- **Severity is a property of the event type**, read from `SECURITY_EVENT_SEVERITY`. Call sites never pass a severity.
- **Caller data goes under `meta`, never spread onto the record.**
- **No secret, token, presigned URL or password reaches `meta`.** Redaction itself is SECH-115.
- **Pre-commit, every time:** `npm run lint` (zero errors), `npx tsc --noEmit` (zero errors), `npm test` (zero failures). Auth/permissions/API-route changes additionally require `npm run test:integration`.
- **`main` is protected.** Work on a branch; ship via `gh pr create --base main --fill`, `gh pr checks --watch`, `gh pr merge --squash --delete-branch`.
- **Every commit message ends with** `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **TS target does not support spreading a Set** (TS2802) — use `Array.from(new Set(...))`.

## Review Focus

These are the failure modes the spec implies but that a naive reading of the tasks would not exercise. Each has a test assigned to the task that owns the code.

1. **A logger that throws takes down the path it was logging.** `JSON.stringify` throws on a circular structure or a `BigInt` — passing a Prisma object into `meta` is a realistic mistake. An exception inside `emit()` during a failed login would convert a 401 into a 500. Covered in Task 2.
2. **A `meta` key colliding with a reserved field** (`meta: { type: "spoofed" }`) must not overwrite the real `type`/`evt`/`severity`, or an attacker-influenced value could disguise an event from an alert rule. Covered in Task 2.
3. **A `meta` string containing a newline** must not split one event across two log lines — line-oriented consumers would see a corrupt record and a stray fragment. Covered in Task 2.
4. **A malformed or hostile inbound `x-request-id`** (CRLF, 10 KB of text, non-UUID) must be discarded and regenerated, not echoed into the log stream. Covered in Task 1.
5. **An event emitted with no request context** — the `/api/auth` login path middleware never runs on — must still carry a `requestId`. Covered in Task 2.

---

# Phase 1 — schema and plumbing

## Task 1: Request-ID module

**Files:**
- Create: `src/lib/request-id.ts`
- Test: `src/lib/__tests__/request-id.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `REQUEST_ID_HEADER: "x-request-id"`, `randomRequestId(): string`, `isValidRequestId(v: unknown): boolean`, `normalizeRequestId(inbound: string | null | undefined): string`, `requestIdFromHeaders(headers: Headers): string | undefined`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/request-id.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  REQUEST_ID_HEADER,
  randomRequestId,
  isValidRequestId,
  normalizeRequestId,
  requestIdFromHeaders,
} from "@/lib/request-id";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("request-id", () => {
  it("exposes the header name", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });

  it("generates a valid UUID", () => {
    const id = randomRequestId();
    expect(isValidRequestId(id)).toBe(true);
    expect(id).not.toBe(randomRequestId());
  });

  it("accepts a well-formed inbound id and lowercases it", () => {
    expect(normalizeRequestId(UUID.toUpperCase())).toBe(UUID);
  });

  // Review Focus 4: the value lands in a log stream, so anything malformed is
  // discarded rather than echoed. A CRLF would otherwise forge a second log line.
  it.each([
    ["missing", null],
    ["empty", ""],
    ["not a uuid", "abc123"],
    ["crlf injection", `${UUID}\r\n{"evt":"security","type":"forged"}`],
    ["newline injection", `${UUID}\ninjected`],
    ["overlong", "a".repeat(10_000)],
    ["uuid with trailing text", `${UUID}-extra`],
  ])("regenerates for an inbound id that is %s", (_label, inbound) => {
    const result = normalizeRequestId(inbound as string | null);
    expect(isValidRequestId(result)).toBe(true);
    expect(result).not.toBe(inbound);
  });

  it("reads a valid id from headers and ignores an invalid one", () => {
    expect(requestIdFromHeaders(new Headers({ [REQUEST_ID_HEADER]: UUID }))).toBe(UUID);
    expect(requestIdFromHeaders(new Headers({ [REQUEST_ID_HEADER]: "nope" }))).toBeUndefined();
    expect(requestIdFromHeaders(new Headers())).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/request-id.test.ts`
Expected: FAIL — cannot resolve `@/lib/request-id`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/request-id.ts`:

```ts
/**
 * Request/correlation IDs (SECH-114).
 *
 * Imports nothing on purpose: this module is used from src/middleware.ts, which runs on
 * the Edge runtime. `crypto` here is the global Web Crypto, NOT node:crypto — the node
 * builtin is unavailable on Edge.
 */

export const REQUEST_ID_HEADER = "x-request-id";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function randomRequestId(): string {
  return crypto.randomUUID();
}

export function isValidRequestId(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * An inbound id is honoured only if it is a well-formed UUID. Everything else is
 * replaced. The value is written into a log stream, so an unvalidated header is a
 * log-injection vector — a CRLF would forge a second, attacker-authored event line.
 * Validating rather than always regenerating keeps the door open to a real upstream
 * trace ID later.
 */
export function normalizeRequestId(inbound: string | null | undefined): string {
  return isValidRequestId(inbound) ? (inbound as string).toLowerCase() : randomRequestId();
}

export function requestIdFromHeaders(headers: Headers): string | undefined {
  const value = headers.get(REQUEST_ID_HEADER);
  return isValidRequestId(value) ? (value as string).toLowerCase() : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/request-id.test.ts`
Expected: PASS, 5 test cases plus the 7 parameterised ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/request-id.ts src/lib/__tests__/request-id.test.ts
git commit -m "$(cat <<'MSG'
Add request/correlation ID helpers (SECH-114)

Zero-dependency so Edge middleware can use it. An inbound x-request-id is
honoured only when it is a well-formed UUID; anything else is regenerated,
because the value lands in a log stream and a CRLF would forge a log line.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 2: Security-event module

**Files:**
- Create: `src/lib/security-events.ts`
- Test: `src/lib/__tests__/security-events.test.ts`

**Interfaces:**
- Consumes: `randomRequestId` from `@/lib/request-id` (Task 1).
- Produces: `SecurityEventType` (union), `SecuritySeverity = "info" | "warn" | "critical"`, `SECURITY_EVENT_SEVERITY: Record<SecurityEventType, SecuritySeverity>`, `SECURITY_EVENT_TYPES: SecurityEventType[]`, `securityEvent(type: SecurityEventType, fields?: SecurityEventFields): void`, and `SecurityEventFields = { requestId?: string; userId?: string; orgId?: string; ip?: string; meta?: Record<string, unknown> }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/security-events.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  securityEvent,
  SECURITY_EVENT_TYPES,
  SECURITY_EVENT_SEVERITY,
  type SecurityEventType,
} from "@/lib/security-events";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

/** The single line the emitter wrote, parsed. */
function emitted(): Record<string, unknown> {
  expect(warn).toHaveBeenCalledTimes(1);
  const line = warn.mock.calls[0][0] as string;
  expect(typeof line).toBe("string");
  return JSON.parse(line);
}

describe("securityEvent", () => {
  it("emits the documented record shape", () => {
    securityEvent("auth.login_failed", {
      requestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      userId: "u1",
      orgId: "o1",
      ip: "203.0.113.4",
      meta: { reason: "invalid_credentials" },
    });

    const rec = emitted();
    expect(rec.evt).toBe("security");
    expect(rec.type).toBe("auth.login_failed");
    expect(rec.severity).toBe("warn");
    expect(rec.requestId).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(rec.userId).toBe("u1");
    expect(rec.orgId).toBe("o1");
    expect(rec.ip).toBe("203.0.113.4");
    expect(rec.meta).toEqual({ reason: "invalid_credentials" });
    expect(new Date(rec.ts as string).toISOString()).toBe(rec.ts);
  });

  it("omits absent optional fields rather than emitting nulls", () => {
    securityEvent("csp.violation");
    const rec = emitted();
    expect(rec).not.toHaveProperty("userId");
    expect(rec).not.toHaveProperty("orgId");
    expect(rec).not.toHaveProperty("ip");
  });

  // Review Focus 5: /api/auth is excluded from the middleware matcher, so login
  // failures arrive with no request context at all. They still need a correlation ID.
  it("generates a requestId when none is supplied", () => {
    securityEvent("auth.login_failed");
    expect(emitted().requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  // Review Focus 2: a meta key must never overwrite a reserved field, or an
  // attacker-influenced value could disguise an event from an alert rule.
  it("never lets meta clobber a reserved top-level field", () => {
    securityEvent("auth.login_failed", {
      meta: { evt: "not-security", type: "spoofed", severity: "info", requestId: "x" },
    });

    const rec = emitted();
    expect(rec.evt).toBe("security");
    expect(rec.type).toBe("auth.login_failed");
    expect(rec.severity).toBe("warn");
    expect((rec.meta as Record<string, unknown>).type).toBe("spoofed");
  });

  // Review Focus 3: line-oriented consumers must never see one event split in two.
  it("emits exactly one line even when meta contains newlines", () => {
    securityEvent("upload.rejected", { meta: { fileName: "a\nb\r\nc" } });
    const line = warn.mock.calls[0][0] as string;
    expect(line.split("\n")).toHaveLength(1);
    expect(JSON.parse(line).meta.fileName).toBe("a\nb\r\nc");
  });

  // Review Focus 1: JSON.stringify throws on circular structures and BigInt. An
  // exception here would turn a failed login into a 500 — the logger must never be
  // the reason a request dies.
  it("does not throw when meta cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => securityEvent("auth.login_failed", { meta: circular })).not.toThrow();
    const rec = emitted();
    expect(rec.type).toBe("auth.login_failed");
    expect((rec.meta as Record<string, unknown>).serializationFailed).toBe(true);
  });

  it("does not throw on a BigInt in meta", () => {
    expect(() => securityEvent("apikey.created", { meta: { n: BigInt(1) } })).not.toThrow();
    expect((emitted().meta as Record<string, unknown>).serializationFailed).toBe(true);
  });
});

describe("event catalog", () => {
  it("assigns a severity to every type", () => {
    for (const type of SECURITY_EVENT_TYPES) {
      expect(SECURITY_EVENT_SEVERITY[type]).toMatch(/^(info|warn|critical)$/);
    }
  });

  it("has no duplicate types", () => {
    expect(Array.from(new Set(SECURITY_EVENT_TYPES))).toHaveLength(SECURITY_EVENT_TYPES.length);
  });

  // Pinning the catalog makes adding an event type a deliberate, reviewable diff.
  // A typo'd free-form type would otherwise create an event no alert rule matches.
  it("matches the pinned catalog", () => {
    const expected: SecurityEventType[] = [
      "auth.login_failed",
      "auth.login_throttled",
      "auth.v1_key_invalid",
      "auth.v1_throttled",
      "ratelimit.monitor_would_block",
      "csp.violation",
      "authz.denied_not_member",
      "authz.denied_private_project",
      "authz.denied_not_org_member",
      "authz.denied_role",
      "authz.denied_admin",
      "oauth.token_failed",
      "oauth.refresh_reuse_detected",
      "apikey.created",
      "apikey.revoked",
      "apikey.used_after_revoke",
      "session.invalidated",
      "upload.rejected",
      "admin.action",
    ];
    expect([...SECURITY_EVENT_TYPES].sort()).toEqual([...expected].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/security-events.test.ts`
Expected: FAIL — cannot resolve `@/lib/security-events`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/security-events.ts`:

```ts
import { randomRequestId } from "./request-id";

/**
 * Structured security events (SECH-114).
 *
 * One shape, one catalog, one emit seam. Severity is a property of the event TYPE,
 * not something a call site passes, so the same event can never be reported at two
 * different severities from two places.
 *
 * SECH-115 inserts redaction inside emit(); SECH-117 adds a sink there. Neither has
 * to touch a call site.
 */

export type SecuritySeverity = "info" | "warn" | "critical";

export type SecurityEventType =
  // Phase 1 — converted from pre-existing ad-hoc logging
  | "auth.login_failed"
  | "auth.login_throttled"
  | "auth.v1_key_invalid"
  | "auth.v1_throttled"
  | "ratelimit.monitor_would_block"
  | "csp.violation"
  // Phase 2 — net-new emissions
  | "authz.denied_not_member"
  | "authz.denied_private_project"
  | "authz.denied_not_org_member"
  | "authz.denied_role"
  | "authz.denied_admin"
  | "oauth.token_failed"
  | "oauth.refresh_reuse_detected"
  | "apikey.created"
  | "apikey.revoked"
  | "apikey.used_after_revoke"
  | "session.invalidated"
  | "upload.rejected"
  | "admin.action";

export const SECURITY_EVENT_SEVERITY: Record<SecurityEventType, SecuritySeverity> = {
  "auth.login_failed": "warn",
  "auth.login_throttled": "warn",
  "auth.v1_key_invalid": "warn",
  "auth.v1_throttled": "warn",
  "ratelimit.monitor_would_block": "info",
  "csp.violation": "info",
  // Tenancy-boundary denials are near-zero volume in normal use and are the highest
  // signal an attacker is probing across orgs, so they are warn and always emitted.
  "authz.denied_not_member": "warn",
  "authz.denied_private_project": "warn",
  "authz.denied_not_org_member": "warn",
  "authz.denied_role": "info",
  "authz.denied_admin": "warn",
  "oauth.token_failed": "warn",
  // A replayed refresh token means a token leaked or a family was cloned.
  "oauth.refresh_reuse_detected": "critical",
  "apikey.created": "info",
  "apikey.revoked": "info",
  // A revoked key still being presented means the holder has not noticed, or is not
  // the person we revoked it from.
  "apikey.used_after_revoke": "critical",
  "session.invalidated": "info",
  "upload.rejected": "warn",
  "admin.action": "info",
};

export const SECURITY_EVENT_TYPES = Object.keys(SECURITY_EVENT_SEVERITY) as SecurityEventType[];

export type SecurityEventFields = {
  requestId?: string;
  userId?: string;
  orgId?: string;
  ip?: string;
  /** Caller detail. Nested, never spread — a caller key must not overwrite `type`. */
  meta?: Record<string, unknown>;
};

export function securityEvent(type: SecurityEventType, fields: SecurityEventFields = {}): void {
  emit({
    evt: "security",
    ts: new Date().toISOString(),
    type,
    severity: SECURITY_EVENT_SEVERITY[type],
    // Middleware does not run on /api/auth, where login failures originate, so an
    // event may legitimately arrive with no request context. Every event still gets
    // a correlation ID.
    requestId: fields.requestId ?? randomRequestId(),
    ...(fields.userId ? { userId: fields.userId } : {}),
    ...(fields.orgId ? { orgId: fields.orgId } : {}),
    ...(fields.ip ? { ip: fields.ip } : {}),
    ...(fields.meta ? { meta: fields.meta } : {}),
  });
}

/**
 * The single write point. JSON.stringify throws on circular structures and BigInt,
 * and a caller passing a Prisma object into meta is a realistic mistake — an
 * exception here would turn a failed login into a 500, so it degrades instead.
 */
function emit(record: Record<string, unknown>): void {
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({
      evt: record.evt,
      ts: record.ts,
      type: record.type,
      severity: record.severity,
      requestId: record.requestId,
      meta: { serializationFailed: true },
    });
  }
  console.warn(line);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/security-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/security-events.ts src/lib/__tests__/security-events.test.ts
git commit -m "$(cat <<'MSG'
Add the structured security-event helper and catalog (SECH-114)

Closed type catalog with severity keyed by type, and a single emit() seam for
SECH-115 redaction and SECH-117 sinks. meta is nested rather than spread so a
caller key cannot overwrite type/severity, and emit() degrades instead of
throwing when meta will not serialize — a logger must never be the reason a
failed login becomes a 500.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 3: Middleware request-ID wiring

**Files:**
- Modify: `src/middleware.ts`
- Test: `src/__tests__/request-id-middleware.test.ts`

**Interfaces:**
- Consumes: `REQUEST_ID_HEADER`, `normalizeRequestId` from `@/lib/request-id` (Task 1).
- Produces: nothing importable. Guarantees `x-request-id` on every request header set and on every response middleware returns.

`src/middleware.ts` wraps NextAuth's `auth()`, so unit-testing the exported handler means mocking the auth provider — brittle, and this file is the one thing on every request. Instead the pure logic lives in Task 1 (fully unit-tested), and this task pins the wiring by reading the source, the same way `security-headers.test.ts` pins `next.config.mjs`. Live behavior is confirmed by curl in Step 5.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/request-id-middleware.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SECH-114. src/middleware.ts wraps NextAuth's auth(), so exercising the handler
 * directly means mocking the auth provider. The logic it depends on is pure and
 * unit-tested in request-id.test.ts; what this pins is that middleware actually
 * wires it up, on every return path. Same approach as security-headers.test.ts.
 */
const SRC = fs.readFileSync(path.join(__dirname, "..", "middleware.ts"), "utf8");

describe("middleware request-ID wiring", () => {
  it("imports the helpers rather than rolling its own", () => {
    expect(SRC).toMatch(/from\s+["']@?\/?(\.\/)?lib\/request-id["']/);
    expect(SRC).toMatch(/normalizeRequestId\s*\(/);
  });

  it("never imports node:crypto, which is unavailable on the Edge runtime", () => {
    expect(SRC).not.toMatch(/from\s+["']node:crypto["']/);
    expect(SRC).not.toMatch(/require\(["']crypto["']\)/);
  });

  it("sets the id on the forwarded request headers", () => {
    expect(SRC).toMatch(/requestHeaders\.set\(\s*REQUEST_ID_HEADER/);
  });

  it("applies the id to every response it returns", () => {
    const returns = SRC.match(/return\s+(NextResponse\.|withRequestId\()/g) ?? [];
    expect(returns.length).toBeGreaterThan(0);
    // Every response leaves through the helper that stamps the header.
    const bare = SRC.match(/return\s+NextResponse\./g) ?? [];
    expect(bare).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/request-id-middleware.test.ts`
Expected: FAIL — middleware does not import `request-id`, and every `return NextResponse.` is currently bare.

- [ ] **Step 3: Write minimal implementation**

Modify `src/middleware.ts`. Add the import beside the existing ones:

```ts
import { REQUEST_ID_HEADER, normalizeRequestId } from "@/lib/request-id";
```

Immediately after `const requestHeaders = new Headers(req.headers);`, add:

```ts
  // SECH-114: one correlation ID per request, forwarded to handlers and echoed on the
  // response so a report can be tied back to its log lines. Inbound values are validated
  // in normalizeRequestId — an unvalidated header would be a log-injection vector.
  const requestId = normalizeRequestId(req.headers.get(REQUEST_ID_HEADER));
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const withRequestId = (res: NextResponse) => {
    res.headers.set(REQUEST_ID_HEADER, requestId);
    return res;
  };
```

Then wrap every existing return. Each of the five `return NextResponse.next({ request: { headers: requestHeaders } });` becomes:

```ts
  return withRequestId(NextResponse.next({ request: { headers: requestHeaders } }));
```

Each of the two redirects becomes:

```ts
  return withRequestId(NextResponse.redirect(new URL("/", nextUrl)));
```

```ts
  return withRequestId(NextResponse.redirect(loginUrl));
```

Leave the matcher, the auth checks and the route branches exactly as they are. The helper is synchronous and adds no imports beyond the zero-dependency module.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/request-id-middleware.test.ts`
Expected: PASS.

Then confirm nothing else broke:

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Verify live**

```bash
npm run dev
```

In another shell:

```bash
curl -sI localhost:3000/login | grep -i x-request-id
```

Expected: one `x-request-id:` header with a UUID. Run it twice — the values must differ.

```bash
curl -sI -H 'x-request-id: 3f2504e0-4f89-41d3-9a0c-0305e82c3301' localhost:3000/login | grep -i x-request-id
```

Expected: the same UUID echoed back.

```bash
curl -sI -H 'x-request-id: not-a-uuid' localhost:3000/login | grep -i x-request-id
```

Expected: a freshly generated UUID, **not** `not-a-uuid`.

- [ ] **Step 6: Commit**

```bash
git add src/middleware.ts src/__tests__/request-id-middleware.test.ts
git commit -m "$(cat <<'MSG'
Generate and propagate a request ID in middleware (SECH-114)

Every forwarded request carries x-request-id, and every response middleware
returns echoes it — which satisfies "include it in error responses" without
touching a single route handler, and gives correlation on success too.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 4: Convert the six existing ad-hoc log sites

**Files:**
- Modify: `src/lib/rate-limit.ts` (delete `logAuthFailure` at :182-191; convert the monitor-mode warn at :105)
- Modify: `src/lib/auth.ts:25` and `:39`
- Modify: `src/lib/v1-auth.ts:19` and `:37`
- Modify: `src/app/api/csp-report/route.ts:71`
- Modify: `src/lib/__tests__/v1-auth.test.ts` (assertions move to the new module)
- Modify: `src/__tests__/session-invalidation.test.ts`, `src/__tests__/cleanup-orphaned-attachments.test.ts`, `src/__tests__/tenancy.test.ts` (drop the now-dead `logAuthFailure: vi.fn()` mock entries)

**Interfaces:**
- Consumes: `securityEvent` from `@/lib/security-events` (Task 2); `requestIdFromHeaders` from `@/lib/request-id` (Task 1).
- Produces: `logAuthFailure` no longer exists. Anything importing it fails to compile — that is the point.

- [ ] **Step 1: Update the v1-auth test to assert on the new module**

In `src/lib/__tests__/v1-auth.test.ts`, remove `logAuthFailure: vi.fn(),` from the `mockRateLimit` factory and add a mock for the new module beneath the existing `vi.mock`:

```ts
const { mockSecurityEvents } = vi.hoisted(() => ({
  mockSecurityEvents: { securityEvent: vi.fn() },
}));

vi.mock("@/lib/security-events", () => mockSecurityEvents);
```

Replace the two assertions that referenced `mockRateLimit.logAuthFailure`:

```ts
  // SH-021 / SECH-109: a rejected key must never reach the log line that records the
  // failure — logs are the one place a wrong-but-nearly-right secret would sit in plaintext.
  it("never writes the presented key into the auth-failure event", async () => {
    const presented = "almost-correct-secret-ke";
    await requireV1ApiKey(makeRequest({ "X-Internal-Api-Key": presented }));

    expect(mockSecurityEvents.securityEvent).toHaveBeenCalled();
    const logged = JSON.stringify(mockSecurityEvents.securityEvent.mock.calls);
    expect(logged).not.toContain(presented);
    expect(logged).not.toContain(REAL_KEY);
    expect(logged).toContain("auth.v1_key_invalid"); // canary: we are looking at the right call
  });
```

and, in the "doesn't match" test:

```ts
    expect(mockSecurityEvents.securityEvent).toHaveBeenCalledWith(
      "auth.v1_key_invalid",
      expect.objectContaining({ ip: "203.0.113.5" })
    );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/v1-auth.test.ts`
Expected: FAIL — `securityEvent` was never called; `v1-auth.ts` still calls `logAuthFailure`.

- [ ] **Step 3: Convert the call sites**

In `src/lib/rate-limit.ts`, delete the whole `logAuthFailure` export (lines 182-191). Replace the monitor-mode block at :105:

```ts
  if (process.env.RATE_LIMIT_MODE === "monitor") {
    securityEvent("ratelimit.monitor_would_block", { meta: { scope: key.split(":")[0] } });
    return { allowed: true, retryAfterSeconds: 0 };
  }
```

and add at the top: `import { securityEvent } from "./security-events";`

In `src/lib/auth.ts`, drop `logAuthFailure` from the `./rate-limit` import, add `import { securityEvent } from "./security-events";`, and replace the two calls:

```ts
          securityEvent("auth.login_throttled", { ip, meta: { email, reason: "rate_limited" } });
```

```ts
          securityEvent("auth.login_failed", { ip, meta: { email, reason: "invalid_credentials" } });
```

In `src/lib/v1-auth.ts`, drop `logAuthFailure` from the `./rate-limit` import and add:

```ts
import { securityEvent } from "./security-events";
import { requestIdFromHeaders } from "./request-id";
```

Capture the id once, beside the existing `const ip = getClientIp(request);`:

```ts
  const requestId = requestIdFromHeaders(request.headers);
```

and replace the two calls:

```ts
    securityEvent("auth.v1_throttled", { requestId, ip, meta: { reason: "rate_limited" } });
```

```ts
    securityEvent("auth.v1_key_invalid", { requestId, ip, meta: { reason: "invalid_key" } });
```

The presented key is never passed — that is what the test above pins.

In `src/app/api/csp-report/route.ts`, add `import { securityEvent } from "@/lib/security-events";`, capture the IP once (it is already computed for the limiter — hoist it to a `const ip` above the `allow(ip)` call), and replace the `console.warn("[csp-report]", …)` block:

```ts
  securityEvent("csp.violation", {
    ip,
    meta: {
      directive:
        report["effective-directive"] ?? report["violated-directive"] ?? report["effectiveDirective"],
      blocked: scrub(report["blocked-uri"] ?? report["blockedURL"]),
      document: scrub(report["document-uri"] ?? report["documentURL"]),
      source: scrub(report["source-file"] ?? report["sourceFile"]),
      line: typeof report["line-number"] === "number" ? report["line-number"] : undefined,
      disposition: report["disposition"],
    },
  });
```

`scrub()` is unchanged — it already strips query strings, which is exactly right.

- [ ] **Step 4: Remove the dead mock entries**

Delete the line `logAuthFailure: vi.fn(),` from the `@/lib/rate-limit` mock factory in each of:
- `src/__tests__/session-invalidation.test.ts:46`
- `src/__tests__/cleanup-orphaned-attachments.test.ts:11`
- `src/__tests__/tenancy.test.ts`

These files do not assert on it; the entry simply names an export that no longer exists.

- [ ] **Step 5: Run the full suite**

Run: `npx tsc --noEmit`
Expected: no output. A `Cannot find name 'logAuthFailure'` here means a call site was missed.

Run: `npm test`
Expected: zero failures. Per CLAUDE.md, run this locally rather than letting CI find a stale mock — that is the JFR-131 failure mode exactly.

- [ ] **Step 6: Commit**

```bash
git add -A src/lib src/app/api/csp-report src/__tests__
git commit -m "$(cat <<'MSG'
Convert every ad-hoc security log to securityEvent (SECH-114)

logAuthFailure is deleted rather than wrapped: a compatibility shim would leave
two shapes in the codebase, which is the condition this ticket exists to end.
Login, v1-api, monitor-mode and CSP reports now emit the same record. The
csp-report scrub() is untouched — it already strips query strings.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 5: Anti-regression guard

**Files:**
- Create: `src/__tests__/security-logging-sinks.test.ts`

**Interfaces:**
- Consumes: nothing at runtime; reads source files.
- Produces: nothing importable.

Without this, the next person to add a security signal reaches for `console.warn` and the ticket silently un-lands.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/security-logging-sinks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SECH-114: securityEvent() is the only way a security signal gets written.
 *
 * The value of a structured stream is that it is complete — one console.warn added
 * later is an event SECH-117 can never alert on, and nobody notices until an incident.
 * This is the same guard shape as rich-text-sinks.test.ts.
 */

const SRC = path.join(__dirname, "..");
const SKIP_PATH = /(__tests__|[/\\]integration[/\\]|test-support)/;

/** The one file allowed to write a security event. */
const EMITTER = "lib/security-events.ts";

/** Prefixes that used to mark an ad-hoc security log. None may come back. */
const ADHOC_PREFIXES = [/\[security\]/, /\[csp-report\]/];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (SKIP_PATH.test(full)) continue;
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
const FILES = walk(SRC).map((f) => ({ rel: rel(f), text: fs.readFileSync(f, "utf8") }));

describe("security logging has one sink", () => {
  it("scanned a plausible number of files", () => {
    expect(FILES.length).toBeGreaterThan(50); // canary: the walk actually found the tree
  });

  it("has no ad-hoc [security] or [csp-report] log lines anywhere", () => {
    const offenders = FILES.flatMap(({ rel, text }) =>
      text
        .split("\n")
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => ADHOC_PREFIXES.some((re) => re.test(line)))
        .filter(([, line]) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
        .map(([n, line]) => `${rel}:${n}: ${line.trim()}`)
    );

    expect(offenders).toEqual([]);
  });

  it("only security-events.ts emits the security record", () => {
    const offenders = FILES.filter(
      ({ rel, text }) => rel !== EMITTER && /evt:\s*["']security["']/.test(text)
    ).map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  it("the emitter is the only file calling console.warn with a JSON.stringify payload", () => {
    const offenders = FILES.filter(
      ({ rel, text }) => rel !== EMITTER && /console\.warn\(\s*JSON\.stringify/.test(text)
    ).map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/__tests__/security-logging-sinks.test.ts`
Expected: PASS — Task 4 already removed every offender. (This guard is written after the cleanup, so a green run is the correct first result. Confirm it can fail: temporarily add `console.warn("[security] x");` to `src/lib/utils.ts`, re-run, see it fail, then remove it.)

- [ ] **Step 3: Confirm the guard actually bites**

```bash
printf '\nconsole.warn("[security] canary");\n' >> src/lib/utils.ts
npx vitest run src/__tests__/security-logging-sinks.test.ts
```
Expected: FAIL naming `lib/utils.ts`.

```bash
git checkout src/lib/utils.ts
npx vitest run src/__tests__/security-logging-sinks.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/security-logging-sinks.test.ts
git commit -m "$(cat <<'MSG'
Guard that securityEvent stays the only security-log sink (SECH-114)

A structured stream is only useful if it is complete; one console.warn added
later is an event SECH-117 can never alert on. Verified the guard fails on a
planted canary before committing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 6: Ship Phase 1

**Files:** none changed.

- [ ] **Step 1: Run the full pre-commit checklist**

```bash
npm run lint
```
Expected: zero errors. Pre-existing `@next/next/no-img-element` warnings are fine; new warnings are not.

```bash
npx tsc --noEmit
```
Expected: no output.

```bash
npm test
```
Expected: zero failures.

```bash
npm run test:integration
```
Expected: zero failures. Required because `auth.ts` and middleware changed. Needs the local Docker DB (`docker start taskforge-db`).

- [ ] **Step 2: Confirm only this session's files are staged**

```bash
git diff --name-only origin/main...HEAD
```
Expected: only the spec, the plan, `src/lib/request-id.ts`, `src/lib/security-events.ts`, `src/middleware.ts`, `src/lib/rate-limit.ts`, `src/lib/auth.ts`, `src/lib/v1-auth.ts`, `src/app/api/csp-report/route.ts` and the five test files. **Do not stage the `644`/`755` mode-only diffs** on `rich-text-display.tsx` or `vitest.config.ts` — those are a known WSL artifact.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin HEAD
gh pr create --base main --fill
gh pr checks --watch
```
Expected: `Verify`, `Integration (cross-tenant)`, `Secret scan` and `Dependency audit` all pass.

- [ ] **Step 4: Merge and watch the deploy**

```bash
gh pr merge --squash --delete-branch
until gh run list --repo jedmond1971/taskforge --branch main --limit 1 2>&1 | grep -qE "completed"; do sleep 10; done
gh run list --repo jedmond1971/taskforge --branch main --limit 1
```
Expected: `completed  success`.

---

# Phase 2 — net-new emissions

Start Phase 2 on a fresh branch off the updated `main`.


## Task 7: Authorization denials

**Files:**
- Modify: `src/lib/permissions.ts` (`resolveProjectRole` :106-139, `requireOrgRole` :191-204, `requireAdmin` :215-217)
- Create: `src/__tests__/authz-denial-events.test.ts`

**Interfaces:**
- Consumes: `securityEvent` from `@/lib/security-events`.
- Produces: no new exports. The thrown errors are byte-for-byte unchanged; events are emitted alongside them.

A **new** test file rather than an addition to `src/__tests__/permissions.test.ts`: that file deliberately mocks only `prisma.groupPermission.findMany`, because it tests the pure `canX` helpers and avoids `resolveProjectRole` entirely. Widening its mock would destabilise 40-odd passing tests for an unrelated concern.

The denial classification is the spec's section 3 — emit for boundary crossings, stay silent for the two zero-signal reasons.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/authz-denial-events.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAuth, mockPrisma, mockSecurityEvents } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    project: { findUnique: vi.fn() },
    projectMember: { findUnique: vi.fn() },
    groupPermission: { findMany: vi.fn() },
  },
  mockSecurityEvents: { securityEvent: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/security-events", () => mockSecurityEvents);

import { requireProjectRole, canEditIssues, canManageProject } from "@/lib/permissions";

const USER = { id: "u1", role: "USER" };
const PROJECT = { id: "p1", key: "PL", orgId: "o1", isPrivate: false, isClosed: false };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: USER });
  mockPrisma.project.findUnique.mockResolvedValue(PROJECT);
  mockPrisma.projectMember.findUnique.mockResolvedValue({ role: "TEAM_MEMBER" });
  mockPrisma.groupPermission.findMany.mockResolvedValue([]);
});

describe("authorization-denial events (SECH-114)", () => {
  it("emits a tenancy event when the caller is not a project member", async () => {
    mockPrisma.projectMember.findUnique.mockResolvedValue(null);

    await expect(requireProjectRole("PL", canEditIssues)).rejects.toThrow("Not a project member");
    expect(mockSecurityEvents.securityEvent).toHaveBeenCalledWith(
      "authz.denied_not_member",
      expect.objectContaining({ userId: "u1", orgId: "o1" })
    );
  });

  it("emits a tenancy event for a private project the caller cannot see", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ ...PROJECT, isPrivate: true });
    mockPrisma.projectMember.findUnique.mockResolvedValue(null);

    await expect(requireProjectRole("PL", canEditIssues)).rejects.toThrow(
      "You do not have access to this project."
    );
    expect(mockSecurityEvents.securityEvent).toHaveBeenCalledWith(
      "authz.denied_private_project",
      expect.objectContaining({ userId: "u1", orgId: "o1" })
    );
  });

  it("emits a role event when the member's role is too low", async () => {
    await expect(requireProjectRole("PL", canManageProject)).rejects.toThrow("Forbidden");
    expect(mockSecurityEvents.securityEvent).toHaveBeenCalledWith(
      "authz.denied_role",
      expect.objectContaining({ userId: "u1", orgId: "o1" })
    );
  });

  it("emits nothing at all on the allowed path", async () => {
    await expect(requireProjectRole("PL", canEditIssues)).resolves.toMatchObject({ userId: "u1" });
    expect(mockSecurityEvents.securityEvent).not.toHaveBeenCalled();
  });

  // Spec section 3: these are normal application flow, not security events. Emitting
  // them is what would create the volume problem that sampling exists to solve.
  it("emits nothing for an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(requireProjectRole("PL", canEditIssues)).rejects.toThrow("Unauthorized");
    expect(mockSecurityEvents.securityEvent).not.toHaveBeenCalled();
  });

  it("emits nothing when the project is merely closed", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ ...PROJECT, isClosed: true });

    await expect(requireProjectRole("PL", canEditIssues)).rejects.toThrow("This project is closed");
    expect(mockSecurityEvents.securityEvent).not.toHaveBeenCalled();
  });

  it("emits nothing when the project does not exist", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);

    await expect(requireProjectRole("PL", canEditIssues)).rejects.toThrow("Project not found");
    expect(mockSecurityEvents.securityEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/authz-denial-events.test.ts`
Expected: FAIL — the three "emits" tests fail because `securityEvent` is never called. The four "emits nothing" tests pass already; that is correct, they are pinning the silence.

- [ ] **Step 3: Add the emissions**

In `src/lib/permissions.ts`, add `import { securityEvent } from "./security-events";` and emit immediately before the relevant throws inside `resolveProjectRole`:

```ts
    if (!privacyCheck) {
      securityEvent("authz.denied_private_project", {
        userId: session.user.id,
        orgId: project.orgId,
        meta: { projectId: project.id },
      });
      throw new Error("You do not have access to this project.");
    }
```

```ts
  if (!membership) {
    securityEvent("authz.denied_not_member", {
      userId: session.user.id,
      orgId: project.orgId,
      meta: { projectId: project.id },
    });
    throw new Error("Not a project member");
  }
```

```ts
  if (!check(membership.role, grants)) {
    securityEvent("authz.denied_role", {
      userId: session.user.id,
      orgId: project.orgId,
      meta: { projectId: project.id, role: membership.role },
    });
    throw new Error("Forbidden");
  }
```

In `requireOrgRole`, before `throw new Error("Not an organization member")`:

```ts
    securityEvent("authz.denied_not_org_member", { userId: session.user.id, orgId });
```

and before its `throw new Error("Forbidden")`:

```ts
    securityEvent("authz.denied_role", {
      userId: session.user.id,
      orgId,
      meta: { role: membership.role },
    });
```

In `requireAdmin`, before `throw new Error("Forbidden")`:

```ts
    securityEvent("authz.denied_admin", {
      userId: session.user.id,
      meta: { role: session.user.role },
    });
```

**Add nothing** to the `Unauthorized`, `Project not found` or `This project is closed` branches. That silence is the design, and Step 1's last four tests pin it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/authz-denial-events.test.ts`
Expected: PASS, all 7.

Run: `npm test`
Expected: zero failures — confirm `permissions.test.ts` still passes untouched.

Run: `npm run test:integration`
Expected: zero failures. `permissions.ts` is squarely in the cross-tenant suite's blast radius.

- [ ] **Step 5: Commit**

```bash
git add src/lib/permissions.ts src/__tests__/authz-denial-events.test.ts
git commit -m "$(cat <<'MSG'
Emit authorization-denial events, classified by reason (SECH-114)

Tenancy-boundary denials always emit; expired-session, project-not-found and
closed-project denials emit nothing, because they are normal navigation and
logging them is what would create the volume problem sampling exists to solve.
Tests pin the silence as well as the emissions. Thresholding stays in SECH-117
where it can be tuned without a deploy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 8: OAuth token failures and refresh reuse

**Files:**
- Modify: `src/app/api/oauth/token/route.ts` (the `tokenError` helper; the reuse branch at :211-213)
- Create: `src/__tests__/security-event-wiring.test.ts`

**Interfaces:**
- Consumes: `securityEvent`, `requestIdFromHeaders`.
- Produces: no new exports.

Driving this with a behavioural test would mean standing up the whole OAuth token exchange — client lookup, PKCE, token rows. That belongs in the integration suite, not here. Instead this task starts the **wiring guard**: a source-reading test in the house style (`constant-time-secrets.test.ts`) that fails until the route actually calls `securityEvent` with the right type. Tasks 9, 10 and 11 add their cases to the same file.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/security-event-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SECH-114: each event type in the catalog has to actually be emitted somewhere.
 *
 * A type declared but never wired is worse than a missing one — SECH-117 writes an
 * alert rule against it, the rule never fires, and the silence reads as "no attacks".
 * Static, like constant-time-secrets.test.ts: it proves the call exists, and the
 * integration suite proves the behaviour.
 */

const SRC = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

/** Each event type, and a file that must emit it. */
const WIRING: Array<{ type: string; file: string }> = [
  { type: "oauth.token_failed", file: "app/api/oauth/token/route.ts" },
  { type: "oauth.refresh_reuse_detected", file: "app/api/oauth/token/route.ts" },
];

describe("security-event wiring", () => {
  it.each(WIRING)("$file emits $type", ({ type, file }) => {
    expect(read(file)).toContain(`"${type}"`);
  });

  // The presented credential must never travel with the failure event.
  it("the OAuth token route never puts a presented secret in an event", () => {
    const src = read("app/api/oauth/token/route.ts");
    const eventLines = src
      .split("\n")
      .filter((l) => /securityEvent\(|clientSecret|code_verifier|refresh_token/.test(l));
    const offending = eventLines.filter((l) =>
      /securityEvent\([^)]*(clientSecret|codeVerifier|refreshTokenValue|plaintext)/.test(l)
    );
    expect(offending).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/security-event-wiring.test.ts`
Expected: FAIL — both wiring cases, because the route contains neither string.

- [ ] **Step 3: Wire the route**

In `src/app/api/oauth/token/route.ts`, add:

```ts
import { securityEvent } from "@/lib/security-events";
import { requestIdFromHeaders } from "@/lib/request-id";
```

Give `tokenError` two extra parameters rather than reaching for module state, and emit inside it:

```ts
function tokenError(
  error: string,
  description: string,
  status = 400,
  ctx: { requestId?: string; clientId?: string } = {}
) {
  securityEvent("oauth.token_failed", {
    requestId: ctx.requestId,
    meta: { error, clientId: ctx.clientId },
  });
  // ...existing response construction, unchanged
}
```

At the top of the handler capture `const requestId = requestIdFromHeaders(request.headers);`, and pass `{ requestId, clientId }` as the fourth argument at each existing `tokenError(...)` call site (`clientId` is already in scope at each; pass `undefined` at the two that run before it is parsed).

Carry **only** the OAuth `error` code and the client id — never the presented code, client secret, `code_verifier` or refresh token. Step 1's second test pins that.

In the reuse branch at :211-213, emit before revoking the family:

```ts
    if (refreshToken.revokedAt !== null) {
      securityEvent("oauth.refresh_reuse_detected", {
        requestId,
        userId: refreshToken.userId,
        orgId: refreshToken.orgId,
        meta: { clientId, familyId: refreshToken.familyId },
      });
      await revokeTokenFamily(refreshToken.familyId);
      return tokenError("invalid_grant", "Refresh token is invalid, expired, or revoked", 400, {
        requestId,
        clientId,
      });
    }
```

If `refreshToken`'s `select` does not already include `userId`/`orgId`/`familyId`, widen it — `familyId` is already selected for the revoke.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/security-event-wiring.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit` — expected: no output.
Run: `npm test` — expected: zero failures.
Run: `npm run test:integration` — expected: zero failures.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/oauth/token/route.ts src/__tests__/security-event-wiring.test.ts
git commit -m "$(cat <<'MSG'
Emit OAuth token-failure and refresh-reuse events (SECH-114)

Reuse is critical severity: a replayed refresh token means one leaked or a
family was cloned. Only the OAuth error code and client id travel with the
event, never the presented code, secret or token — pinned by a test.

Adds the wiring guard that later tasks extend, so a catalog type that is never
actually emitted fails the build rather than silently producing an alert rule
that can never fire.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 9: API key lifecycle

**Files:**
- Modify: `src/app/(dashboard)/org-settings/actions.ts` (create ~:64; revoke ~:118)
- Modify: `src/lib/external-api-auth.ts:36`
- Modify: `src/lib/credential-revocation.ts:24`
- Modify: `src/__tests__/security-event-wiring.test.ts` (add cases)

**Interfaces:**
- Consumes: `securityEvent`.
- Produces: no new exports.

`external-api-auth.ts:36` currently treats "no such key" and "key revoked" identically. They are different signals — a revoked key still being presented means the holder has not noticed, or is not who we revoked it from — so the branch splits to emit only the second. The 401 stays identical so the response still reveals nothing.

- [ ] **Step 1: Extend the failing test**

In `src/__tests__/security-event-wiring.test.ts`, add to the `WIRING` array:

```ts
  { type: "apikey.created", file: "app/(dashboard)/org-settings/actions.ts" },
  { type: "apikey.revoked", file: "app/(dashboard)/org-settings/actions.ts" },
  { type: "apikey.used_after_revoke", file: "lib/external-api-auth.ts" },
```

and add a new test to the file:

```ts
  it("api-key events carry the id and prefix but never the key or its hash", () => {
    const files = ["app/(dashboard)/org-settings/actions.ts", "lib/external-api-auth.ts"];
    const offending = files.flatMap((f) =>
      read(f)
        .split("\n")
        .map((line, i) => [i + 1, line] as const)
        .filter(([, l]) => /securityEvent\(/.test(l) || /apiKeyId|keyPrefix/.test(l))
        .filter(([, l]) => /securityEvent\([^)]*(plaintext|hashedKey|incoming)/.test(l))
        .map(([n, l]) => `${f}:${n}: ${l.trim()}`)
    );
    expect(offending).toEqual([]);
  });

  it("the external API returns an identical 401 whether the key is unknown or revoked", () => {
    const src = read("lib/external-api-auth.ts");
    // One shared rejection path: the log distinguishes the cases, the response must not.
    expect(src.match(/status:\s*401/g) ?? []).toHaveLength(2); // missing header + the shared branch
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/security-event-wiring.test.ts`
Expected: FAIL — the three new wiring cases.

- [ ] **Step 3: Wire the call sites**

In `src/app/(dashboard)/org-settings/actions.ts`, import `securityEvent`, then after the `prisma.apiKey.create(...)`:

```ts
  securityEvent("apikey.created", {
    userId,
    orgId,
    meta: { apiKeyId: created.id, keyPrefix },
  });
```

Never pass `plaintext` or `hashedKey`. After the revoke `prisma.apiKey.update(...)`:

```ts
  securityEvent("apikey.revoked", { userId, orgId, meta: { apiKeyId: keyId } });
```

In `src/lib/external-api-auth.ts`, split the branch at :36 while keeping one rejection path:

```ts
  if (key && key.revokedAt !== null) {
    securityEvent("apikey.used_after_revoke", {
      orgId: key.orgId,
      meta: { apiKeyId: key.id },
    });
  }

  if (!key || key.revokedAt !== null) {
    // Deliberately the same 401 either way — only the log distinguishes them.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
```

Keep any existing `recordFailure`/rate-limit call in that branch exactly where it is.

In `src/lib/credential-revocation.ts`, after the `updateMany` inside `revokeApiKeysForUser`:

```ts
  securityEvent("apikey.revoked", { userId, orgId, meta: { reason: "credential_revocation" } });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/security-event-wiring.test.ts` — expected: PASS.
Run: `npx tsc --noEmit` — expected: no output.
Run: `npm test` — expected: zero failures.
Run: `npm run test:integration` — expected: zero failures.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/org-settings/actions.ts" src/lib/external-api-auth.ts src/lib/credential-revocation.ts src/__tests__/security-event-wiring.test.ts
git commit -m "$(cat <<'MSG'
Emit API-key lifecycle events (SECH-114)

Splits the external-API auth branch so a revoked-but-presented key is
distinguishable from an unknown one in the log, while the 401 stays byte-identical
so the response still reveals nothing. Only the key id and prefix travel with the
event, never the key or its hash.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 10: Session invalidation and the admin-audit bridge

**Files:**
- Modify: `src/lib/audit-log.ts` (bridge, inside `logAdminAction`)
- Modify: `src/app/(dashboard)/admin/actions.ts:95` (role change) and `:147` (password reset)
- Modify: `src/app/(dashboard)/settings/actions.ts:47` (self-service password change)
- Create: `src/__tests__/audit-log-bridge.test.ts`
- Modify: `src/__tests__/security-event-wiring.test.ts` (add cases)

**Interfaces:**
- Consumes: `securityEvent`.
- Produces: no new exports. `logAdminAction`'s signature is unchanged.

The bridge is one call in one file and gives all 17 admin call sites a presence in the detection stream without duplicating the `AuditAction` enum or touching `admin/actions.ts` for that purpose.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/audit-log-bridge.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { logAdminAction } from "@/lib/audit-log";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mockPrisma.user.findUnique.mockResolvedValue({ name: "Alice", email: "admin@jedforge.dev" });
  mockPrisma.adminAuditLog.create.mockResolvedValue({});
});
afterEach(() => warn.mockRestore());

const action = () =>
  logAdminAction({
    actorId: "u1",
    action: "ROLE_CHANGED",
    targetType: "User",
    targetId: "u2",
    targetLabel: "Bob",
  });

describe("logAdminAction bridge (SECH-114)", () => {
  it("still writes the durable audit row", async () => {
    await action();
    expect(mockPrisma.adminAuditLog.create).toHaveBeenCalled();
  });

  it("also emits exactly one admin.action security event", async () => {
    await action();

    expect(warn).toHaveBeenCalledTimes(1);
    const rec = JSON.parse(warn.mock.calls[0][0] as string);
    expect(rec.type).toBe("admin.action");
    expect(rec.severity).toBe("info");
    expect(rec.userId).toBe("u1");
    expect(rec.meta.action).toBe("ROLE_CHANGED");
    expect(rec.meta.targetType).toBe("User");
    expect(rec.meta.targetId).toBe("u2");
  });

  // The DB row already carries actor name and email for the admin UI. The stream
  // carries the id alone, so a log destination never becomes a second PII sink.
  it("does not put the actor's email or name in the event", async () => {
    await action();
    const line = warn.mock.calls[0][0] as string;
    expect(line).not.toContain("admin@jedforge.dev");
    expect(line).not.toContain("Alice");
  });
});
```

In `src/__tests__/security-event-wiring.test.ts`, add to `WIRING`:

```ts
  { type: "session.invalidated", file: "app/(dashboard)/admin/actions.ts" },
  { type: "session.invalidated", file: "app/(dashboard)/settings/actions.ts" },
  { type: "admin.action", file: "lib/audit-log.ts" },
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/audit-log-bridge.test.ts src/__tests__/security-event-wiring.test.ts`
Expected: FAIL — no event emitted; three new wiring cases missing.

- [ ] **Step 3: Add the bridge and the invalidation events**

In `src/lib/audit-log.ts`, import `securityEvent` and add after the `prisma.adminAuditLog.create(...)`:

```ts
  // SECH-114 bridge: the DB row stays the system of record for the admin UI; this puts
  // the same action into the detection stream so SECH-117 can alert on it. Actor name
  // and email stay in the row — the stream carries the id alone.
  securityEvent("admin.action", {
    userId: params.actorId,
    meta: {
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
    },
  });
```

In `src/app/(dashboard)/admin/actions.ts`, after the `adminUpdateUser` update that uses the `data` built at :95, guarded so it fires only when the version actually bumped:

```ts
  if (roleChanged) {
    securityEvent("session.invalidated", {
      userId: id,
      meta: { trigger: "admin_role_change" },
    });
  }
```

After the password-reset update at :147:

```ts
  securityEvent("session.invalidated", {
    userId: id,
    meta: { trigger: "admin_password_reset" },
  });
```

In `src/app/(dashboard)/settings/actions.ts`, after the update at :47:

```ts
  securityEvent("session.invalidated", {
    userId,
    meta: { trigger: "self_password_change" },
  });
```

Use whatever each file already calls the target user's id (`id`, `userId`, `targetUserId`) rather than introducing a new name — check the enclosing function before editing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/audit-log-bridge.test.ts src/__tests__/security-event-wiring.test.ts` — expected: PASS.
Run: `npm test` — expected: zero failures.
Run: `npm run test:integration` — expected: zero failures. `admin/actions.ts` is covered by `everyAdminAction()` in `src/integration/admin-actions.itest.ts`; this task adds no new export, so that list needs no change.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audit-log.ts "src/app/(dashboard)/admin/actions.ts" "src/app/(dashboard)/settings/actions.ts" src/__tests__/audit-log-bridge.test.ts src/__tests__/security-event-wiring.test.ts
git commit -m "$(cat <<'MSG'
Bridge the admin audit log into the event stream, emit session invalidation (SECH-114)

One call in logAdminAction gives all 17 admin call sites a presence in the
detection stream without duplicating the AuditAction enum. The DB row stays the
system of record and keeps actor name/email; the stream carries the id alone, so
the log destination does not become a second PII sink.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 11: Upload rejections and catalog coverage

**Files:**
- Modify: `src/app/api/attachments/presign/route.ts:28`, `:32`
- Modify: `src/app/api/attachments/upload/route.ts:32`, `:36`, `:72`
- Modify: `src/app/api/attachments/confirm/route.ts:41`, `:44`, `:94`
- Modify: `src/app/api/editor-images/route.ts:42`
- Modify: `src/__tests__/security-event-wiring.test.ts` (add cases and the coverage assertion)

**Interfaces:**
- Consumes: `securityEvent`, `requestIdFromHeaders`.
- Produces: no new exports.

This is the last wiring task, so it also closes the loop: after it, every type in the catalog has a real call site, and the coverage assertion below makes that permanent.

- [ ] **Step 1: Extend the failing test**

In `src/__tests__/security-event-wiring.test.ts`, add to `WIRING`:

```ts
  { type: "upload.rejected", file: "app/api/attachments/presign/route.ts" },
  { type: "upload.rejected", file: "app/api/attachments/upload/route.ts" },
  { type: "upload.rejected", file: "app/api/attachments/confirm/route.ts" },
  { type: "upload.rejected", file: "app/api/editor-images/route.ts" },
```

and add the coverage assertion, which needs a directory walk:

```ts
import { SECURITY_EVENT_TYPES } from "@/lib/security-events";

const SKIP_PATH = /(__tests__|[/\\]integration[/\\]|test-support|security-events\.ts)/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (SKIP_PATH.test(full)) continue;
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

describe("catalog coverage", () => {
  const ALL_SOURCE = walk(SRC)
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");

  // A type declared but never emitted produces an alert rule that can never fire, and
  // the resulting silence reads as "no attacks". Every catalog entry must be wired.
  it.each(SECURITY_EVENT_TYPES)("%s is emitted somewhere outside the catalog", (type) => {
    expect(ALL_SOURCE).toContain(`"${type}"`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/security-event-wiring.test.ts`
Expected: FAIL — the four `upload.rejected` wiring cases and the `upload.rejected` coverage case.

- [ ] **Step 3: Wire the four routes**

In each route add:

```ts
import { securityEvent } from "@/lib/security-events";
import { requestIdFromHeaders } from "@/lib/request-id";
```

capture `const requestId = requestIdFromHeaders(request.headers);` once in the handler, and emit immediately before each existing rejection response. Use these exact `reason` values so the stream stays queryable:

- MIME-allowlist failures (`presign:28`, `upload:32`, `confirm:41`) — `reason: "mime_type"`, with `meta.declaredType`.
- Size-cap failures (`presign:32`, `upload:36`, `confirm:44`) — `reason: "size"`, with `meta.fileSize`.
- `validateRasterImage` failures (`upload:72`, `confirm:94`, `editor-images:42`) — `reason: "not_raster_image"`, with `meta.declaredType`.

Each emission also carries `route:` set to `"presign"`, `"upload"`, `"confirm"` or `"editor-images"`. For example, in `src/app/api/editor-images/route.ts` at :42:

```ts
  if (!(await validateRasterImage(buffer, file.type))) {
    securityEvent("upload.rejected", {
      requestId,
      userId,
      meta: { reason: "not_raster_image", declaredType: file.type, route: "editor-images" },
    });
    // ...existing rejection response, unchanged
  }
```

Pass `userId` where the handler already has it in scope; omit the field where it does not. Never put the file contents, the buffer or a presigned URL in `meta` — only the declared type, the size, the sanitized name and the route.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/security-event-wiring.test.ts`
Expected: PASS, including every `catalog coverage` case — all 19 types now have a call site.

Run: `npx tsc --noEmit` — expected: no output.
Run: `npm test` — expected: zero failures.
Run: `npm run test:integration` — expected: zero failures.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/attachments src/app/api/editor-images src/__tests__/security-event-wiring.test.ts
git commit -m "$(cat <<'MSG'
Emit upload-rejection events and close catalog coverage (SECH-114)

Fixed reason values (mime_type, size, not_raster_image) plus the route name, so
the stream stays queryable. A declared type that passes the allowlist but fails
magic-byte sniffing is the case worth alerting on (SECH-125).

Adds the coverage assertion: every catalog type must have a real call site, so a
declared-but-unwired type can no longer produce an alert rule that never fires.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 12: Ship Phase 2 and record the findings

**Files:**
- Create: `.context-docs/security-events.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Full pre-commit checklist**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run test:integration
```
Expected: clean on all four. Pre-existing `@next/next/no-img-element` warnings are fine; new warnings are not.

- [ ] **Step 2: Write the reference doc**

Create `.context-docs/security-events.md` covering: the record schema; the full catalog table (type, severity, emitting file) as shipped; the denial-classification rule and **why the two zero-signal denials are deliberately silent**; the `emit()` seam and what SECH-115/117 are expected to do with it; the `/api/auth` matcher gap and the lazy-ID fallback; and the rule that adding an event type means updating both `SECURITY_EVENT_SEVERITY` and the pinned list in `security-events.test.ts`.

- [ ] **Step 3: Add the short CLAUDE.md entry**

Under **Security constraints**, add a few lines only — per the standing feedback that CLAUDE.md stays lean and detail lives in `.context-docs/`:

- `securityEvent()` in `src/lib/security-events.ts` is the only security-log sink; `src/__tests__/security-logging-sinks.test.ts` fails on a `console.warn` security signal.
- Severity is keyed by event type in the catalog, never passed by a call site.
- Adding an event type means updating the pinned catalog list and wiring a real call site (`security-event-wiring.test.ts` enforces both).
- Middleware sets `x-request-id` on every request and response; `/api/auth` is outside the matcher, so `securityEvent()` generates one when absent.

Add one line to the **Reference docs** index pointing at `.context-docs/security-events.md`.

- [ ] **Step 4: Commit the docs**

```bash
git add .context-docs/security-events.md CLAUDE.md
git commit -m "$(cat <<'MSG'
docs: record the security-event logger invariants (SECH-114)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

- [ ] **Step 5: Open, watch, merge**

```bash
git push -u origin HEAD
gh pr create --base main --fill
gh pr checks --watch
gh pr merge --squash --delete-branch
until gh run list --repo jedmond1971/taskforge --branch main --limit 1 2>&1 | grep -qE "completed"; do sleep 10; done
gh run list --repo jedmond1971/taskforge --branch main --limit 1
```
Expected: `completed  success`.

- [ ] **Step 6: Post the fix summary to SECH-114**

Post as Maximus via the production v1 REST API — the MCP connector tools authenticate as Jamie and have no `authorId` override. Use a heredoc: bash expands backticks inside `"` and inside `python3 -c "..."` alike.

```bash
python3 << 'PYEOF'
import urllib.request, json, os

summary = """
<p><strong>Shipped in two PRs.</strong></p>
<p><strong>What changed.</strong> <code>securityEvent()</code> in
<code>src/lib/security-events.ts</code> is now the only place a security signal is
written: a closed catalog of 19 event types, severity keyed by type, emitted as
single-line JSON through one <code>emit()</code> seam. Middleware generates or
propagates <code>x-request-id</code> on every request and response.
<code>logAuthFailure</code> is deleted.</p>
<p><strong>Security rationale.</strong> Denials are classified rather than sampled:
tenancy-boundary denials always emit, while expired-session and closed-project
denials emit nothing, because sampling a population dominated by expired sessions
reliably misses the single cross-tenant probe. Thresholding stays in SECH-117 where
it is tunable without a deploy. An inbound <code>x-request-id</code> is honoured only
if it is a well-formed UUID — otherwise it is a log-injection vector.
<code>emit()</code> degrades rather than throwing on unserializable meta, so the
logger can never turn a failed login into a 500.</p>
<p><strong>Not in scope.</strong> Central redaction (SECH-115), error tracking
(SECH-116) and alerting (SECH-117) install behind the same seam. The login-failure
event still carries <code>email</code>, as before — flagged for SECH-115 to decide.</p>
<p><strong>Tests.</strong> Shape, catalog-pinning, wiring-coverage and
ad-hoc-logging guards; lint, tsc, unit and cross-tenant integration all green.</p>
"""

req = urllib.request.Request(
    "https://taskforge-production-099b.up.railway.app/api/v1/issues/SECH-114/comments",
    data=json.dumps({"authorId": "cmo365psl000vdrd0p63lirlz", "body": summary}).encode(),
    method="POST",
    headers={"X-Internal-Api-Key": os.environ["V1_API_KEY"], "Content-Type": "application/json"},
)
print(urllib.request.urlopen(req).status)
PYEOF
```

- [ ] **Step 7: Move SECH-114 to Done**

```bash
python3 << 'PYEOF'
import urllib.request, json, os
req = urllib.request.Request(
    "https://taskforge-production-099b.up.railway.app/api/v1/issues/SECH-114",
    data=json.dumps({"statusId": "Done"}).encode(), method="PATCH",
    headers={"X-Internal-Api-Key": os.environ["V1_API_KEY"], "Content-Type": "application/json"})
print(json.load(urllib.request.urlopen(req)).get("issue", {}).get("status", {}).get("name"))
PYEOF
```
