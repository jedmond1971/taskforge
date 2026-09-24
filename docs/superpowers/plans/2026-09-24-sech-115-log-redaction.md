# SECH-115 Log Redaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop document content, secrets and tokens reaching production logs, from all three sources that leak them today.

**Architecture:** One redaction module (`src/lib/redaction.ts`) with key-based scrubbing for objects and pattern-based scrubbing for strings, plus a discard-and-summarise path for Prisma errors. Three thin adapters feed it: Prisma's event-based error logging, a production-only `console` patch in `instrumentation.ts`, and a `logError()` helper replacing 68 raw `console.error` call sites. `securityEvent`'s existing `emit()` seam calls the same redactor.

**Tech Stack:** TypeScript, Next.js 16.3.4 (App Router, `instrumentation.ts`), Prisma 5.22.0, Vitest. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-sech-115-log-redaction-design.md`

## Global Constraints

- **No new runtime dependencies.** Anything added must clear `src/__tests__/dependency-pinning.test.ts` and the `Dependency audit` CI gate. This ticket adds none.
- **The console patch is production-only.** Development keeps full-fidelity Prisma output; redacting it would make debugging materially worse.
- **`console.log` must be patched, not just `console.error`.** Prisma's logger writes via `console.log` — measured. Patching only `error` looks correct and is not.
- **Bare `code` must never be added to the sensitive-key list.** It collides with Prisma's error `code` (`P2002`), the diagnostic this work exists to preserve.
- **No generic high-entropy matching.** Cuids are 25-char alphanumeric; an entropy heuristic would redact every id in every log line.
- **Redaction must fail open.** If redaction throws, log the original. A silently dropped error log is worse than an unredacted one.
- **Pre-commit, every time:** `npm run lint` (zero errors), `npx tsc --noEmit` (zero errors), `npm test` (zero failures). Auth/permissions/route/action changes also require `npm run test:integration`.
- **`main` is protected.** Branch, `gh pr create --base main`, `gh pr checks --watch`, `gh pr merge --squash --delete-branch`. Fill `.github/pull_request_template.md` rather than using `--fill`.
- **Every commit message ends with** `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **TS target does not support spreading a Set** (TS2802) — use `Array.from(new Set(...))`.

## Review Focus

Failure modes the spec implies that a naive reading of the tasks would not exercise. Each has a test assigned to the task owning the code.

1. **Over-redaction silently destroys diagnostics.** If the key list or patterns are too broad, logs still appear but say nothing — discovered only during an incident. Prisma's `code`/`P2002` and ordinary cuids must survive untouched. Covered in Tasks 2 and 3.
2. **The redactor throwing takes down logging.** A cyclic object, a `BigInt`, or a getter that throws must not propagate out of `redact()` or the console patch. Covered in Tasks 2 and 6.
3. **The console patch re-entering itself.** The patched `console.log` calls redaction, which (directly or via a throw handler) calls `console.log` again — infinite recursion, stack overflow, dead server. Covered in Task 6.
4. **Double-patching.** `instrumentation.ts` running twice wraps `console` twice, so every line is redacted twice and any prefix is doubled. Covered in Task 6.
5. **Env-secret substitution with a short or empty variable.** If `AUTH_SECRET` is unset or two characters, a naive "replace this value everywhere" rule matches everything and redacts the whole log. Covered in Task 1.

---

# Phase 1 — the redactor and the two uncatchable leaks

## Task 1: Secret corpus and string redaction

**Files:**
- Create: `src/test-support/secret-payloads.ts`
- Create: `src/lib/redaction.ts`
- Test: `src/lib/__tests__/redaction.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `REDACTED: "[redacted]"`, `redactString(input: string): string`.

- [ ] **Step 1: Write the corpus fixture**

Create `src/test-support/secret-payloads.ts`:

```ts
/**
 * SECH-115 — shared secret corpus.
 *
 * One list of real secret SHAPES, used by the redaction unit tests. Import from tests
 * only; nothing in the app imports this file. The Prisma entry is a verbatim capture
 * from a production build (SECH-115 evidence), not a hand-written approximation — the
 * whole point is that the redactor is tested against what Prisma actually emits.
 */

export interface SecretPayload {
  name: string;
  /** A string that must never survive redaction intact. */
  payload: string;
  /** The substring that must be gone afterwards. */
  mustNotSurvive: string;
  note: string;
}

export const SECRET_PAYLOADS: SecretPayload[] = [
  {
    name: "jwt",
    payload:
      "session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    mustNotSurvive: "dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    note: "NextAuth session JWT shape.",
  },
  {
    name: "bearer-header",
    payload: "Authorization: Bearer sk-live-abcdef0123456789abcdef0123456789",
    mustNotSurvive: "sk-live-abcdef0123456789abcdef0123456789",
    note: "Authorization header echoed by a failing HTTP client.",
  },
  {
    name: "basic-header",
    payload: "Authorization: Basic Y2xpZW50OnN1cGVyLXNlY3JldA==",
    mustNotSurvive: "Y2xpZW50OnN1cGVyLXNlY3JldA==",
    note: "OAuth confidential-client credentials.",
  },
  {
    name: "org-api-key",
    payload: "key=jfk_live_HZ3kQp9vTn2bXw7LrYs4Md6Ae8Cu1Gf0",
    mustNotSurvive: "HZ3kQp9vTn2bXw7LrYs4Md6Ae8Cu1Gf0",
    note: "Org API key. The jfk_live_ prefix may survive; the random tail may not.",
  },
  {
    name: "presigned-url",
    payload:
      "https://bucket.storageapi.dev/attachments/abc.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20260924%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0",
    mustNotSurvive: "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0",
    note: "Presigned S3 URL. Keep origin+path for debugging, drop the signing query.",
  },
  {
    name: "prisma-validation-error",
    payload: [
      "",
      "Invalid `prisma.docPage.create()` invocation:",
      "",
      "{",
      '  data: {',
      '    title: "probe",',
      '    content: "CONFIDENTIAL-DOC-BODY-abc123",',
      "    thisFieldDoesNotExist: true",
      "  }",
      "}",
      "",
      "Argument `docSpace` is missing.",
    ].join("\n"),
    mustNotSurvive: "CONFIDENTIAL-DOC-BODY-abc123",
    note: "Verbatim shape captured from a production build. Prisma embeds the whole data object.",
  },
];

/** Values that must SURVIVE redaction — over-redaction is the silent failure. */
export const MUST_SURVIVE: Array<{ name: string; value: string }> = [
  { name: "cuid", value: "cmo365psl000vdrd0p63lirlz" },
  { name: "prisma-error-code", value: "P2002" },
  { name: "issue-key", value: "SECH-115" },
  { name: "column-name", value: "userId_projectId" },
  { name: "ordinary-url", value: "https://www.jedforge.com/projects/PL/issues" },
];
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/__tests__/redaction.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { redactString, REDACTED } from "@/lib/redaction";
import { SECRET_PAYLOADS, MUST_SURVIVE } from "@/test-support/secret-payloads";

describe("redactString", () => {
  it.each(SECRET_PAYLOADS.filter((p) => p.name !== "prisma-validation-error"))(
    "scrubs $name",
    ({ payload, mustNotSurvive }) => {
      expect(redactString(payload)).not.toContain(mustNotSurvive);
    }
  );

  it("keeps the API key prefix so a key is still identifiable", () => {
    const out = redactString("key=jfk_live_HZ3kQp9vTn2bXw7LrYs4Md6Ae8Cu1Gf0");
    expect(out).toContain("jfk_live_");
    expect(out).not.toContain("HZ3kQp9vTn2bXw7LrYs4Md6Ae8Cu1Gf0");
  });

  it("keeps origin and path of a presigned URL, drops the signing query", () => {
    const out = redactString(SECRET_PAYLOADS.find((p) => p.name === "presigned-url")!.payload);
    expect(out).toContain("https://bucket.storageapi.dev/attachments/abc.png");
    expect(out).not.toContain("X-Amz-Signature");
  });

  // Review Focus 1: over-redaction is the failure nobody notices until an incident.
  it.each(MUST_SURVIVE)("leaves $name untouched", ({ value }) => {
    expect(redactString(`context ${value} more`)).toContain(value);
  });

  it("redacts a literal env secret value wherever it appears", () => {
    process.env.TEST_ONLY_SECRET = "s3cret-value-long-enough-to-match";
    try {
      const out = redactString("connect failed for s3cret-value-long-enough-to-match", [
        "TEST_ONLY_SECRET",
      ]);
      expect(out).not.toContain("s3cret-value-long-enough-to-match");
      expect(out).toContain(REDACTED);
    } finally {
      delete process.env.TEST_ONLY_SECRET;
    }
  });

  // Review Focus 5: a short or empty variable must not become a match-everything rule.
  it.each([
    ["empty", ""],
    ["too short", "abc"],
  ])("ignores an env secret that is %s", (_label, value) => {
    process.env.TEST_ONLY_SECRET = value;
    try {
      const out = redactString("a perfectly ordinary log line about abc", ["TEST_ONLY_SECRET"]);
      expect(out).toBe("a perfectly ordinary log line about abc");
    } finally {
      delete process.env.TEST_ONLY_SECRET;
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/redaction.test.ts`
Expected: FAIL — cannot resolve `@/lib/redaction`.

- [ ] **Step 4: Write minimal implementation**

Create `src/lib/redaction.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/redaction.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/test-support/secret-payloads.ts src/lib/redaction.ts src/lib/__tests__/redaction.test.ts
git commit -m "$(cat <<'MSG'
Add the secret corpus and string redaction (SECH-115)

Pattern-based scrubbing for strings that have no keys left to match on: JWTs,
Authorization headers, presigned S3 signing queries, org API keys (prefix kept),
and the literal values of secret env vars.

No generic high-entropy matching: cuids are 25-char alphanumeric, so an entropy
heuristic would redact every id in every log line. The corpus therefore carries
a MUST_SURVIVE list as well, because over-redaction is the failure nobody
notices until an incident.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 2: Object redaction with caps

**Files:**
- Modify: `src/lib/redaction.ts`
- Test: `src/lib/__tests__/redaction.test.ts`

**Interfaces:**
- Consumes: `redactString`, `REDACTED` (Task 1).
- Produces: `SENSITIVE_KEYS: Set<string>`, `redact(value: unknown): unknown`, `MAX_STRING_LENGTH: 200`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/redaction.test.ts`:

```ts
import { redact, SENSITIVE_KEYS } from "@/lib/redaction";

describe("redact (objects)", () => {
  it("scrubs sensitive keys at any depth", () => {
    const out = redact({
      ok: "keep me",
      passwordHash: "$2a$12$abcdefghijklmnop",
      nested: { content: "secret doc body", token: "abc123", alsoOk: "keep" },
    }) as Record<string, unknown>;

    expect(out.ok).toBe("keep me");
    expect(out.passwordHash).toBe(REDACTED);
    const nested = out.nested as Record<string, unknown>;
    expect(nested.content).toBe(REDACTED);
    expect(nested.token).toBe(REDACTED);
    expect(nested.alsoOk).toBe("keep");
  });

  it("matches keys case-insensitively", () => {
    const out = redact({ Authorization: "Bearer x", PasswordHash: "y" }) as Record<string, unknown>;
    expect(out.Authorization).toBe(REDACTED);
    expect(out.PasswordHash).toBe(REDACTED);
  });

  // Review Focus 1: `code` must stay readable or Prisma diagnostics are worthless.
  it("never treats `code` as sensitive", () => {
    expect(SENSITIVE_KEYS.has("code")).toBe(false);
    const out = redact({ code: "P2002", target: "docPage.create" }) as Record<string, unknown>;
    expect(out.code).toBe("P2002");
    expect(out.target).toBe("docPage.create");
  });

  it("applies string redaction to values it keeps", () => {
    const out = redact({ note: "Authorization: Bearer sk-live-abcdef0123456789" }) as Record<string, unknown>;
    expect(out.note).not.toContain("sk-live-abcdef0123456789");
  });

  it("does NOT truncate by default", () => {
    // The console patch redacts whole log lines. If redact() capped by default it would
    // truncate every line over 200 chars in production — a catastrophic, silent change.
    const out = redact({ note: "x".repeat(5000) }) as Record<string, unknown>;
    expect((out.note as string).length).toBe(5000);
  });

  it("truncates only when a cap is requested", () => {
    const out = redact({ note: "x".repeat(5000) }, { maxStringLength: 200 }) as Record<string, unknown>;
    expect((out.note as string).length).toBeLessThanOrEqual(220);
  });

  it("maps arrays", () => {
    const out = redact([{ token: "a" }, { ok: "b" }]) as Array<Record<string, unknown>>;
    expect(out[0].token).toBe(REDACTED);
    expect(out[1].ok).toBe("b");
  });

  // Review Focus 2: the redactor must never be the reason a request dies.
  it("does not throw or hang on a cyclic object", () => {
    const cyclic: Record<string, unknown> = { ok: "yes" };
    cyclic.self = cyclic;
    expect(() => redact(cyclic)).not.toThrow();
  });

  it("does not throw on a BigInt or a throwing getter", () => {
    const nasty = {
      big: BigInt(1),
      get boom() {
        throw new Error("getter exploded");
      },
    };
    expect(() => redact(nasty)).not.toThrow();
  });

  it("caps recursion depth rather than descending forever", () => {
    let deep: Record<string, unknown> = { token: "leaf" };
    for (let i = 0; i < 50; i++) deep = { nested: deep };
    expect(() => redact(deep)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/redaction.test.ts`
Expected: FAIL — `redact` and `SENSITIVE_KEYS` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/redaction.ts`:

```ts
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
const MAX_DEPTH = 8;

export interface RedactOptions {
  /**
   * Truncate strings at this length. Left OFF by default on purpose: the console patch
   * redacts whole log lines, and a default cap would silently truncate every line over
   * the limit in production. Only securityEvent's `meta` opts in.
   */
  maxStringLength?: number;
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

  if (depth >= MAX_DEPTH) return "[depth-capped]";
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) return value.map((v) => redactInner(v, depth + 1, seen, opts));

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    try {
      out[key] = redactInner((value as Record<string, unknown>)[key], depth + 1, seen, opts);
    } catch {
      // A throwing getter must not take the whole log line with it.
      out[key] = "[unreadable]";
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/redaction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/redaction.ts src/lib/__tests__/redaction.test.ts
git commit -m "$(cat <<'MSG'
Add key-based object redaction with depth, cycle and length caps (SECH-115)

`code` is deliberately absent from the sensitive-key list: it collides with
Prisma's P2002, the diagnostic this ticket exists to preserve, and a test pins
that. Cycles, BigInts, throwing getters and 50-deep nesting all degrade rather
than throwing — the redactor must never be the reason a request dies.

Also lands SECH-114's inherited 200-character cap on attacker-influenced strings.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 3: `summarizeError` — discard and summarise

**Files:**
- Modify: `src/lib/redaction.ts`
- Test: `src/lib/__tests__/redaction.test.ts`

**Interfaces:**
- Consumes: `redact`, `redactString`, `REDACTED`.
- Produces: `summarizeError(error: unknown): Record<string, unknown>` returning `{ name, message?, target?, code?, columns? }`.

Scrubbing the rendered Prisma message was rejected in the spec: it is a pre-rendered string with no keys, document body is arbitrary text with no pattern, and a regex over Prisma's formatting breaks silently when Prisma changes it. Summarising fails safe.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/redaction.test.ts`:

```ts
import { summarizeError } from "@/lib/redaction";

describe("summarizeError", () => {
  it("drops a Prisma message entirely rather than scrubbing it", () => {
    const prismaMessage = SECRET_PAYLOADS.find((p) => p.name === "prisma-validation-error")!;
    const err = Object.assign(new Error(prismaMessage.payload), {
      name: "PrismaClientValidationError",
      clientVersion: "5.22.0",
    });

    const out = summarizeError(err);

    expect(JSON.stringify(out)).not.toContain(prismaMessage.mustNotSurvive);
    expect(JSON.stringify(out)).not.toContain("data:");
    expect(out.name).toBe("PrismaClientValidationError");
  });

  // Review Focus 1: the summary has to stay worth reading.
  it("keeps the operation, the code and the column names", () => {
    const err = Object.assign(new Error("Unique constraint failed"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      meta: { target: ["userId_projectId"] },
    });

    const out = summarizeError(err);

    expect(out.code).toBe("P2002");
    expect(out.columns).toEqual(["userId_projectId"]);
  });

  it("drops meta.target when it is not a list of plain identifiers", () => {
    const err = Object.assign(new Error("x"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      meta: { target: ["CONFIDENTIAL-DOC-BODY-abc123"] },
    });

    expect(summarizeError(err).columns).toBeUndefined();
  });

  it("keeps a short non-Prisma message, redacted", () => {
    const out = summarizeError(new Error("fetch failed for Bearer sk-live-abcdef0123456789"));
    expect(out.name).toBe("Error");
    expect(String(out.message)).not.toContain("sk-live-abcdef0123456789");
  });

  it("handles a thrown non-Error without throwing", () => {
    expect(() => summarizeError("just a string")).not.toThrow();
    expect(() => summarizeError(null)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/redaction.test.ts`
Expected: FAIL — `summarizeError` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/redaction.ts`:

```ts
/** Prisma renders the whole `data:` object into validation messages — never log one. */
const PRISMA_ERROR_NAMES = new Set([
  "PrismaClientValidationError",
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientInitializationError",
  "PrismaClientRustPanicError",
]);

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

  if (typeof e.code === "string") out.code = e.code;

  const target = e.meta?.target;
  if (Array.isArray(target) && target.every((t) => typeof t === "string" && IDENTIFIER_RE.test(t))) {
    out.columns = target;
  }

  if (PRISMA_ERROR_NAMES.has(e.name)) {
    // `Invalid \`prisma.docPage.create()\` invocation` — the operation, without the payload.
    const op = /Invalid `prisma\.([A-Za-z0-9_.$]+)\(\)` invocation/.exec(e.message ?? "");
    if (op) out.target = op[1];
    out.messageDropped = true;
    return out;
  }

  out.message = capString(redactString(e.message ?? ""), MAX_STRING_LENGTH);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/redaction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/redaction.ts src/lib/__tests__/redaction.test.ts
git commit -m "$(cat <<'MSG'
Summarise Prisma errors instead of scrubbing them (SECH-115)

Prisma embeds the whole `data:` object in a validation message, so the message
is discarded rather than regexed: it is a pre-rendered string with no keys, and
a pattern over Prisma's formatting would break silently the day Prisma changes
it. Operation name, error code and column names survive, which is what actually
gets you to the bug.

meta.target is kept only when every element is a plain identifier, so column
names survive and values never do.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 4: Wire redaction into the security-event emitter

**Files:**
- Modify: `src/lib/security-events.ts` (the private `emit()`)
- Modify: `src/lib/auth.ts` (login-failure email opt-in)
- Test: `src/lib/__tests__/security-events.test.ts`

**Interfaces:**
- Consumes: `redact` from `@/lib/redaction` (Task 2).
- Produces: no new exports. `securityEvent` records pass through `redact()` before serialisation.

`email` is on the sensitive-key list, so the login-failure event must opt in explicitly. That is the spec's resolution of SECH-114's inherited item: default-deny with one named exception, rather than email flowing freely through every log path.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/security-events.test.ts`:

```ts
describe("securityEvent redaction (SECH-115)", () => {
  it("redacts a sensitive key passed in meta", () => {
    securityEvent("oauth.token_failed", { meta: { clientId: "c1", token: "super-secret-value" } });
    const rec = emitted();
    expect((rec.meta as Record<string, unknown>).clientId).toBe("c1");
    expect((rec.meta as Record<string, unknown>).token).toBe("[redacted]");
  });

  it("redacts a secret pattern inside an otherwise innocuous meta value", () => {
    securityEvent("upload.rejected", {
      meta: { reason: "mime_type", note: "Authorization: Bearer sk-live-abcdef0123456789" },
    });
    expect(warn.mock.calls[0][0]).not.toContain("sk-live-abcdef0123456789");
  });

  it("caps an attacker-influenced meta value", () => {
    securityEvent("oauth.token_failed", { meta: { clientId: "x".repeat(5000) } });
    const clientId = (emitted().meta as Record<string, unknown>).clientId as string;
    expect(clientId.length).toBeLessThanOrEqual(220);
  });

  it("does not redact the reserved top-level fields", () => {
    securityEvent("auth.login_failed", { userId: "u1", orgId: "o1", ip: "203.0.113.4" });
    const rec = emitted();
    expect(rec.userId).toBe("u1");
    expect(rec.orgId).toBe("o1");
    expect(rec.ip).toBe("203.0.113.4");
    expect(rec.type).toBe("auth.login_failed");
  });

  // The one documented exception (SECH-114 inherited item): without the address you
  // cannot tell credential stuffing from one person mistyping their password.
  it("keeps the login-failure email, which opts in explicitly", () => {
    securityEvent("auth.login_failed", {
      ip: "203.0.113.4",
      meta: { reason: "invalid_credentials", emailAttempted: "person@example.com" },
    });
    expect(warn.mock.calls[0][0]).toContain("person@example.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/security-events.test.ts`
Expected: FAIL — `token` is emitted verbatim; nothing is redacted or capped.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/security-events.ts`, import the redactor and apply it to caller-supplied fields only — never to the reserved fields the emitter itself sets, or `type` would be mangled:

```ts
import { redact, MAX_STRING_LENGTH } from "./redaction";
```

Inside `securityEvent`, replace the `meta` spread:

```ts
    ...(fields.meta
      ? { meta: redact(fields.meta, { maxStringLength: MAX_STRING_LENGTH }) as Record<string, unknown> }
      : {}),
```

`userId`, `orgId`, `ip`, `type`, `severity` and `requestId` are set by the emitter from typed arguments, not from arbitrary caller data, so they are not passed through `redact()`.

In `src/lib/auth.ts`, rename the login-failure meta key from `email` to `emailAttempted` at both call sites, so the sensitive-key list does not swallow it:

```ts
          securityEvent("auth.login_throttled", {
            ip,
            meta: { emailAttempted: email, reason: "rate_limited" },
          });
```

```ts
          securityEvent("auth.login_failed", {
            ip,
            meta: { emailAttempted: email, reason: "invalid_credentials" },
          });
```

Add a comment at both sites:

```ts
        // SECH-115: `email` is redacted by default; this is the one documented exception.
        // Without the address, credential stuffing is indistinguishable from one person
        // mistyping their password. Renamed so the opt-in is deliberate and greppable.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/security-events.test.ts`
Expected: PASS.

Run: `npm test`
Expected: zero failures. `v1-auth.test.ts` and `authz-denial-events.test.ts` both assert on emitted fields — confirm neither regressed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/security-events.ts src/lib/auth.ts src/lib/__tests__/security-events.test.ts
git commit -m "$(cat <<'MSG'
Redact caller-supplied meta in security events (SECH-115)

Only `meta` passes through the redactor; the reserved fields are set by the
emitter from typed arguments, so redacting them would mangle `type` for no gain.

`email` is redacted by default, so the login-failure sites opt in explicitly via
`emailAttempted` — SECH-114 left that decision here, and default-deny with one
named, greppable exception is the defensible version of it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 5: Prisma event adapter (leak source 1)

**Files:**
- Modify: `src/lib/prisma.ts`
- Test: `src/lib/__tests__/prisma-logging.test.ts`

**Interfaces:**
- Consumes: `summarizeError` (Task 3), `securityEvent` from `@/lib/security-events`.
- Produces: no new exports. Production Prisma no longer prints to stdout.

This is the leak a caller cannot avoid: `prisma:error` fires even when the caller catches. Measured: with `log: ["error"]` the full `data:` block reaches stdout regardless of any `try/catch`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/prisma-logging.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SECH-115. Standing up a real PrismaClient here would need a database, so this pins the
 * CONFIGURATION — which is where the leak lives. The behaviour (that an error event
 * yields a summarised record) is covered by redaction.test.ts driving summarizeError
 * directly.
 */
const SRC = fs.readFileSync(path.join(__dirname, "..", "prisma.ts"), "utf8");

describe("prisma logging configuration", () => {
  it("uses event-based error logging in production, not stdout", () => {
    expect(SRC).toMatch(/emit:\s*["']event["']/);
  });

  it("attaches an error handler", () => {
    expect(SRC).toMatch(/\$on\(\s*["']error["']/);
  });

  it("routes the error through summarizeError rather than logging it raw", () => {
    expect(SRC).toMatch(/summarizeError\s*\(/);
    // The raw message must never be handed to a logger from this file.
    expect(SRC).not.toMatch(/console\.(log|warn|error)\([^)]*\bmessage\b/);
  });

  it("does not keep plain 'error' in the production log array", () => {
    // `log: ["error"]` is the configuration that leaked; it must not survive.
    const prodArrays = SRC.match(/log:\s*\[[^\]]*\]/g) ?? [];
    const leaky = prodArrays.filter((a) => /["']error["']/.test(a) && !/emit/.test(a));
    expect(leaky).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/prisma-logging.test.ts`
Expected: FAIL — the current config is `log: [... "error"]` with no `emit` and no `$on`.

- [ ] **Step 3: Write minimal implementation**

Replace `src/lib/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client";
import { securityEvent } from "@/lib/security-events";
import { summarizeError } from "@/lib/redaction";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * SECH-115: Prisma's own logger prints the full `data:` object of a failed write, and it
 * fires even when the caller catches — measured against a production build. Event-based
 * logging keeps the diagnostic without the payload: `$on("error")` still receives
 * validation errors, carrying the operation name, and nothing goes to stdout.
 *
 * Development deliberately keeps the noisy stdout config: the full payload is exactly
 * what you want when you are already debugging.
 */
function createPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === "development") {
    return new PrismaClient({ log: ["query", "error", "warn"] });
  }

  const client = new PrismaClient({ log: [{ emit: "event", level: "error" }] });
  client.$on("error" as never, (event: { message?: string; target?: string }) => {
    const summary = summarizeError(
      Object.assign(new Error(event.message ?? ""), { name: "PrismaClientError" })
    );
    securityEvent("prisma.error", {
      meta: { ...summary, target: event.target ?? summary.target },
    });
  });
  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
```

Add `"prisma.error"` to the catalog in `src/lib/security-events.ts` — both the `SecurityEventType` union and `SECURITY_EVENT_SEVERITY` (severity `warn`) — and to the pinned list in `src/lib/__tests__/security-events.test.ts`, and add a `WIRING` row in `src/__tests__/security-event-wiring.test.ts`:

```ts
  { type: "prisma.error", file: "lib/prisma.ts" },
```

The catalog-coverage test added in SECH-114 fails otherwise, which is exactly its job.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/prisma-logging.test.ts src/lib/__tests__/security-events.test.ts src/__tests__/security-event-wiring.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Verify the leak is actually closed**

This is the measurement the whole ticket rests on, so repeat it rather than assuming.

```bash
mkdir -p src/app/api/leakcheck-sech115
cat > src/app/api/leakcheck-sech115/route.ts <<'ROUTE'
import { prisma } from "@/lib/prisma";
export async function GET() {
  await prisma.docPage.create({
    // @ts-expect-error deliberate: forces a PrismaClientValidationError
    data: { title: "probe", content: "LEAKMARKER-must-not-reach-logs", thisFieldDoesNotExist: true },
  });
  return new Response("unreachable");
}
ROUTE
npm run build && npm start
```

In another shell: `curl -s -o /dev/null http://localhost:3000/api/leakcheck-sech115`

Expected: the server log contains **no** `LEAKMARKER`. Before this task it appeared twice per request. A `prisma.error` event with `target` should appear instead.

Then remove the probe: `rm -rf src/app/api/leakcheck-sech115`

Note: the route name must not start with `_` — Next.js treats underscore-prefixed folders as private and excludes them from routing, which silently yields a 404 instead of the error you are trying to observe.

- [ ] **Step 6: Commit**

```bash
git add src/lib/prisma.ts src/lib/security-events.ts src/lib/__tests__/prisma-logging.test.ts src/lib/__tests__/security-events.test.ts src/__tests__/security-event-wiring.test.ts
git commit -m "$(cat <<'MSG'
Stop Prisma printing failed-write payloads (SECH-115)

Prisma's own logger prints the whole `data:` object and fires even when the
caller catches, so no call-site discipline prevents it. Production moves to
event-based error logging and summarises; development keeps the full payload,
which is what you want when already debugging.

Verified by rebuilding and re-running the marker probe: the payload that
previously appeared twice per request no longer appears at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 6: Console patch (leak source 2)

**Files:**
- Create: `src/instrumentation.ts`
- Test: `src/__tests__/console-patch.test.ts`

**Interfaces:**
- Consumes: `redact` (Task 2).
- Produces: `register()` (Next's instrumentation hook) and `installConsoleRedaction(target, env)` exported for testing.

Next.js logs uncaught route errors itself, with the same Prisma payload, and nothing else intercepts that. **`console.log` must be wrapped**: Prisma's logger uses `console.log`, not `console.error` — measured.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/console-patch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { installConsoleRedaction } from "@/instrumentation";

function fakeConsole() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => vi.clearAllMocks());

describe("console redaction patch", () => {
  // Prisma logs via console.log, so patching only console.error looks right and is not.
  it.each(["log", "warn", "error"] as const)("patches console.%s", (method) => {
    const c = fakeConsole();
    installConsoleRedaction(c, "production");
    c[method]("Authorization: Bearer sk-live-abcdef0123456789");
    expect(String(c[method].mock.calls[0][0])).not.toContain("sk-live-abcdef0123456789");
  });

  it("redacts object arguments too", () => {
    const c = fakeConsole();
    installConsoleRedaction(c, "production");
    c.error("ctx", { passwordHash: "$2a$12$abcdefghij" });
    expect(JSON.stringify(c.error.mock.calls[0])).not.toContain("$2a$12$abcdefghij");
  });

  it("leaves ordinary lines alone", () => {
    const c = fakeConsole();
    installConsoleRedaction(c, "production");
    c.log("Ready in 93ms");
    expect(c.log.mock.calls[0][0]).toBe("Ready in 93ms");
  });

  it("is a no-op outside production", () => {
    const c = fakeConsole();
    installConsoleRedaction(c, "development");
    c.log("Authorization: Bearer sk-live-abcdef0123456789");
    expect(c.log.mock.calls[0][0]).toContain("sk-live-abcdef0123456789");
  });

  // Review Focus 4: a second install must not wrap the wrapper.
  it("is idempotent", () => {
    const c = fakeConsole();
    installConsoleRedaction(c, "production");
    const afterFirst = c.log;
    installConsoleRedaction(c, "production");
    expect(c.log).toBe(afterFirst);
  });

  // Review Focus 2 and 3: the patch must neither swallow a line nor re-enter itself.
  it("falls open and logs the original when redaction throws", () => {
    const c = fakeConsole();
    const exploding = {
      get boom(): string {
        throw new Error("nope");
      },
      toString() {
        throw new Error("nope");
      },
    };
    installConsoleRedaction(c, "production");
    expect(() => c.error("ctx", exploding)).not.toThrow();
    expect(c.error).toHaveBeenCalled();
  });

  it("does not recurse when redaction itself logs", () => {
    const c = fakeConsole();
    installConsoleRedaction(c, "production");
    // A nested call from inside a patched call must terminate.
    c.log("outer");
    c.log("inner");
    expect(c.log).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/console-patch.test.ts`
Expected: FAIL — cannot resolve `@/instrumentation`.

- [ ] **Step 3: Write minimal implementation**

Create `src/instrumentation.ts`:

```ts
import { redact } from "@/lib/redaction";

type ConsoleLike = Pick<Console, "log" | "warn" | "error">;
type Method = "log" | "warn" | "error";

const METHODS: Method[] = ["log", "warn", "error"];
const PATCHED = Symbol.for("sech115.consolePatched");

/**
 * SECH-115: Next.js logs uncaught route errors itself, carrying the same Prisma payload,
 * and nothing else intercepts that. `console.log` is wrapped as well as `error` because
 * Prisma's own logger uses `log` — patching only `error` looks correct and is not.
 *
 * Production only: in development the full payload is what you want while debugging.
 */
export function installConsoleRedaction(target: ConsoleLike, env: string | undefined): void {
  if (env !== "production") return;

  const marked = target as ConsoleLike & { [PATCHED]?: boolean };
  if (marked[PATCHED]) return; // wrapping the wrapper would redact twice
  marked[PATCHED] = true;

  for (const method of METHODS) {
    const original = target[method].bind(target);
    target[method] = ((...args: unknown[]) => {
      let safe: unknown[];
      try {
        safe = args.map((a) => (typeof a === "string" ? redact(a) : redact(a)));
      } catch {
        // Fail open: a dropped error log is worse than an unredacted one.
        safe = args;
      }
      original(...(safe as Parameters<ConsoleLike[Method]>));
    }) as ConsoleLike[Method];
  }
}

export async function register(): Promise<void> {
  installConsoleRedaction(console, process.env.NODE_ENV);
}
```

There is no recursion risk by construction: `redact()` never logs, and the `catch` calls `original`, which is the unpatched function captured before wrapping.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/console-patch.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify Next actually calls the hook**

```bash
npm run build && npm start
```

Expected in the build output: `instrumentation.ts` is picked up (Next reports an `Instrumentation` entry). Re-run the Task 5 marker probe with the route restored and confirm the marker is still absent — this time proving source 2 is covered even when the route does not catch.

- [ ] **Step 6: Commit**

```bash
git add src/instrumentation.ts src/__tests__/console-patch.test.ts
git commit -m "$(cat <<'MSG'
Redact console output in production via the instrumentation hook (SECH-115)

Next.js logs uncaught route errors itself, with the same Prisma payload, and
nothing else intercepts it. console.log is wrapped as well as error, because
Prisma's logger uses log — patching only error looks correct and is not.

Idempotent so a second install cannot double-wrap, and fail-open so a throwing
redaction logs the original rather than silently dropping the line.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 7: Ship Phase 1

**Files:** none changed.

- [ ] **Step 1: Full pre-commit checklist**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run test:integration
```
Expected: 0 lint errors (45 pre-existing warnings, unchanged), tsc clean, both suites green.

- [ ] **Step 2: Confirm the staged set**

```bash
git diff --name-only origin/main...HEAD
```
Expected: the spec, the plan, `src/lib/redaction.ts`, `src/lib/prisma.ts`, `src/lib/security-events.ts`, `src/lib/auth.ts`, `src/instrumentation.ts`, `src/test-support/secret-payloads.ts` and their tests. **Do not stage the `644`/`755` mode-only diffs** on `vitest.config.ts` or `rich-text-display.tsx` — a known WSL artifact.

- [ ] **Step 3: Open, watch, merge**

```bash
git push -u origin HEAD
gh pr create --base main --body-file /tmp/pr-body.md   # see Step 3a
gh pr checks --watch
gh pr merge --squash --delete-branch
until gh run list --repo jedmond1971/taskforge --branch main --limit 1 2>&1 | grep -qE "completed"; do sleep 10; done
gh run list --repo jedmond1971/taskforge --branch main --limit 1
```
Expected: `Verify`, `Integration (cross-tenant)`, `Secret scan`, `Dependency audit` all pass; main CI `completed success`.

**Step 3a — write the PR body first.** Copy `.github/pull_request_template.md` to
`/tmp/pr-body.md` and fill every section; do not pass `--fill`, which skips the template
entirely. The sections that carry the weight here:

- *Threat or risk addressed*: document content reached production logs from three sources; give
  the measured marker result.
- *Blast radius*: `instrumentation.ts` wraps `console` for every server-side log line in
  production, and `prisma.ts` changes how every Prisma error is reported. No auth or tenancy
  logic changes.
- *Logging and privacy impact*: this is the point of the PR — state what is now redacted, that
  `code`/`P2002` and cuids deliberately survive, and that dev is unpatched.
- *Rollback*: revert the commit range; no schema change, no persisted state.

---

# Phase 2 — call-site conversion

Start Phase 2 on a fresh branch off the updated `main`.

## Task 8: `logError` and the call-site conversion

**Files:**
- Modify: `src/lib/security-events.ts` (add `logError`)
- Modify: the 41 files containing `console.error` (68 call sites)
- Test: `src/lib/__tests__/security-events.test.ts`

**Interfaces:**
- Consumes: `summarizeError`, `redact` from `@/lib/redaction`.
- Produces: `logError(context: string, error: unknown, extra?: Record<string, unknown>): void`, exported from `@/lib/security-events`.

`logError` lives in `security-events.ts`, **not** `redaction.ts`. It needs `securityEvent`, and
`security-events.ts` already imports `redact` — putting it in `redaction.ts` would make the two
modules import each other, and an ESM cycle resolves to `undefined` at module-init time in
exactly the paths that run first.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/redaction.test.ts`:

```ts
import { logError } from "@/lib/security-events";
import { vi, beforeEach, afterEach } from "vitest";

describe("logError", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());

  it("emits a summarised, redacted record naming its context", () => {
    const prisma = SECRET_PAYLOADS.find((p) => p.name === "prisma-validation-error")!;
    const err = Object.assign(new Error(prisma.payload), { name: "PrismaClientValidationError" });

    logError("POST /api/docs/[projectKey]/pages", err);

    const line = warn.mock.calls[0][0] as string;
    expect(line).not.toContain(prisma.mustNotSurvive);
    expect(line).toContain("POST /api/docs/[projectKey]/pages");
  });

  it("does not throw when handed a non-Error", () => {
    expect(() => logError("ctx", "a string")).not.toThrow();
    expect(() => logError("ctx", undefined)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/redaction.test.ts`
Expected: FAIL — `logError` is not exported.

- [ ] **Step 3: Add the helper**

Append to `src/lib/security-events.ts` (which already imports `redact`; add `summarizeError` to that import):

```ts
/**
 * The one way application code logs a caught error. Never pass the raw error to a
 * console method: for a Prisma error that prints the whole failed `data:` object.
 */
export function logError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>
): void {
  securityEvent("app.error", {
    meta: { context, ...summarizeError(error), ...(extra ? { extra: redact(extra) } : {}) },
  });
}
```

Add `"app.error"` to the `SecurityEventType` union and `SECURITY_EVENT_SEVERITY` (severity `warn`) in `src/lib/security-events.ts`, to the pinned list in `security-events.test.ts`, and a `WIRING` row `{ type: "app.error", file: "lib/redaction.ts" }`.

- [ ] **Step 4: Convert the call sites**

Replace every `console.error(...)` in these 41 files with `logError(<context>, error)`, where `<context>` is the route or action name already present in the existing message (e.g. `"GET /api/docs/[projectKey]"`), or the file's exported function name where the message is bare `console.error(error)`.

Files, with call-site counts:

```
5  src/app/api/docs/[projectKey]/sections/[sectionId]/route.ts
4  src/app/(dashboard)/projects/[projectKey]/actions.ts
4  src/app/api/docs/[projectKey]/pages/[pageId]/route.ts
3  src/app/api/v1/issues/[key]/route.ts
3  src/app/api/issues/[issueId]/route.ts
2  src/lib/notifications.ts
2  src/app/(dashboard)/projects/[projectKey]/sprint-actions.ts
2  src/app/(dashboard)/admin/actions.ts
2  src/app/api/v1/issues/route.ts
2  src/app/api/v1/issues/[key]/comments/route.ts
2  src/app/api/v1/issues/[key]/comments/[commentId]/route.ts
2  src/app/api/external/v1/projects/[key]/issues/route.ts
2  src/app/api/external/v1/projects/[key]/issues/[issueKey]/route.ts
2  src/app/api/external/v1/projects/[key]/issues/[issueKey]/comments/route.ts
2  src/app/api/docs/[projectKey]/sections/route.ts
2  src/app/api/docs/[projectKey]/route.ts
2  src/app/api/docs/[projectKey]/pages/route.ts
2  src/app/api/docs/[projectKey]/pages/[pageId]/file/route.ts
1  src/lib/docx-preview.ts
1  src/components/notifications/NotificationDropdown.tsx
1  src/components/notifications/NotificationBell.tsx
1  src/app/(dashboard)/projects/[projectKey]/error.tsx
1  src/app/(dashboard)/projects/[projectKey]/docs/[pageId]/page.tsx
1  src/app/(dashboard)/error.tsx
1  src/app/api/v1/projects/route.ts
1  src/app/api/v1/projects/[id]/route.ts
1  src/app/api/projects/route.ts
1  src/app/api/internal/cleanup-orphaned-attachments/route.ts
1  src/app/api/external/v1/projects/route.ts
1  src/app/api/external/v1/projects/[key]/route.ts
1  src/app/api/docs/[projectKey]/search/route.ts
1  src/app/api/docs/[projectKey]/pages/[pageId]/revisions/route.ts
1  src/app/api/docs/[projectKey]/pages/[pageId]/links/route.ts
1  src/app/api/docs/[projectKey]/pages/[pageId]/images/[imageKey]/route.ts
1  src/app/api/attachments/upload/route.ts
1  src/app/api/attachments/route.ts
1  src/app/api/attachments/presign/route.ts
1  src/app/api/attachments/[id]/url/route.ts
1  src/app/api/attachments/[id]/route.ts
1  src/app/api/attachments/confirm/route.ts
1  src/app/api/ai/chat/route.ts
```

**Four are client components** — `NotificationDropdown.tsx`, `NotificationBell.tsx`, and the two `error.tsx` boundaries. `logError` reaches `securityEvent`, which writes server-side. Leave those four as `console.error` and add them to the guard's allowlist in Task 9 with the reason, rather than shipping a helper that silently does nothing in the browser. Client-side error reporting is SECH-116's problem.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` — expected: no output.
Run: `npm test` — expected: zero failures.
Run: `npm run test:integration` — expected: zero failures (server actions and API routes changed).

- [ ] **Step 6: Commit**

```bash
git add -A src
git commit -m "$(cat <<'MSG'
Route caught errors through logError (SECH-115)

68 call sites across 41 files. Passing a raw error to console.error prints the
whole failed Prisma `data:` object; logError summarises and redacts instead.

The four client-component sites keep console.error deliberately: logError writes
server-side via securityEvent, so using it there would silently do nothing.
Client-side reporting is SECH-116.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 9: Sink guard

**Files:**
- Create: `src/__tests__/console-sinks.test.ts`

**Interfaces:**
- Consumes: nothing at runtime; reads source.
- Produces: nothing importable.

- [ ] **Step 1: Write the test**

Create `src/__tests__/console-sinks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SECH-115: application code does not call console.* directly.
 *
 * Passing a raw error to console.error prints the whole failed Prisma `data:` object —
 * measured. logError() summarises and redacts instead. Without this guard the next
 * catch block reintroduces the leak and nobody notices until an incident.
 */
const SRC = path.join(__dirname, "..");
const SKIP_PATH = /(__tests__|[/\\]integration[/\\]|test-support)/;

const ALLOWED = new Map<string, string>([
  ["lib/security-events.ts", "the event emitter's single write point"],
  ["instrumentation.ts", "the redaction patch itself must call the real console"],
  // Client components: logError writes server-side via securityEvent, so it would
  // silently do nothing in the browser. Client reporting is SECH-116.
  ["components/notifications/NotificationDropdown.tsx", "client component"],
  ["components/notifications/NotificationBell.tsx", "client component"],
  ["app/(dashboard)/error.tsx", "client error boundary"],
  ["app/(dashboard)/projects/[projectKey]/error.tsx", "client error boundary"],
]);

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

describe("console usage", () => {
  const files = walk(SRC).map((f) => ({ rel: rel(f), text: fs.readFileSync(f, "utf8") }));

  it("scanned a plausible number of files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no console.* outside the allowlist", () => {
    const offenders = files
      .filter(({ rel }) => !ALLOWED.has(rel))
      .flatMap(({ rel, text }) =>
        text
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          .filter(([, l]) => /\bconsole\.(log|warn|error|info|debug)\s*\(/.test(l))
          .filter(([, l]) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
          .map(([n, l]) => `${rel}:${n}: ${l.trim()}`)
      );

    expect(offenders).toEqual([]);
  });

  it("every allowlist entry still exists and still uses console", () => {
    // A stale allowlist entry is a hole waiting for a filename to be reused.
    for (const [file] of ALLOWED) {
      const found = files.find((f) => f.rel === file);
      expect(found, `${file} is allowlisted but missing`).toBeTruthy();
      expect(found!.text).toMatch(/\bconsole\./);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/__tests__/console-sinks.test.ts`
Expected: PASS — Task 8 converted everything else.

- [ ] **Step 3: Confirm the guard bites**

```bash
printf '\nconsole.error("canary", new Error("x"));\n' >> src/lib/utils.ts
npx vitest run src/__tests__/console-sinks.test.ts
```
Expected: FAIL naming `lib/utils.ts`.

```bash
git checkout src/lib/utils.ts
npx vitest run src/__tests__/console-sinks.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/console-sinks.test.ts
git commit -m "$(cat <<'MSG'
Guard that application code does not call console directly (SECH-115)

Verified against a planted canary before committing. The allowlist carries a
reason per entry and asserts each entry still exists, so a stale line cannot
quietly become a hole.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 10: Consolidate the csp-report scrub list

**Files:**
- Modify: `src/lib/redaction.ts`
- Modify: `src/app/api/csp-report/route.ts`
- Test: `src/__tests__/csp-report-scrub.test.ts`

**Interfaces:**
- Consumes: `redactString`.
- Produces: `TOKEN_PATH_PREFIXES: string[]`, `redactUrlForLog(value: unknown): string | undefined`.

SECH-114 added invite-token path redaction inside the csp-report route. One list, not two drifting copies.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/redaction.test.ts`:

```ts
import { redactUrlForLog, TOKEN_PATH_PREFIXES } from "@/lib/redaction";

describe("redactUrlForLog", () => {
  it("redacts a token-bearing path prefix", () => {
    expect(redactUrlForLog("https://www.jedforge.com/invite/abc123secret")).toBe(
      "https://www.jedforge.com/invite/[redacted]"
    );
  });

  it("strips the query string", () => {
    expect(redactUrlForLog("https://www.jedforge.com/oauth/authorize?state=s3cr3t")).toBe(
      "https://www.jedforge.com/oauth/authorize"
    );
  });

  it("passes through CSP keywords that are not URLs", () => {
    expect(redactUrlForLog("inline")).toBe("inline");
  });

  it("exports the prefix list so there is one copy", () => {
    expect(TOKEN_PATH_PREFIXES).toContain("/invite/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/redaction.test.ts`
Expected: FAIL — `redactUrlForLog` is not exported.

- [ ] **Step 3: Move the logic**

Append to `src/lib/redaction.ts`:

```ts
/** Routes that carry a secret in the PATH, where dropping the query is not enough. */
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
```

In `src/app/api/csp-report/route.ts`, delete the local `TOKEN_PATH_PREFIXES`, `redactPath` and `scrub`, import `redactUrlForLog`, and replace the three `scrub(...)` calls with it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/redaction.test.ts src/__tests__/csp-report-scrub.test.ts`
Expected: PASS — the SECH-114 scrub tests must still pass against the moved implementation.

- [ ] **Step 5: Commit**

```bash
git add src/lib/redaction.ts src/app/api/csp-report/route.ts
git commit -m "$(cat <<'MSG'
Move the csp-report URL scrubbing onto the shared redactor (SECH-115)

SECH-114 added invite-token path redaction inside the route. One list on the
redactor, not two copies that drift. The existing scrub tests are unchanged and
still pass against the moved implementation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

## Task 11: Ship Phase 2 and record the findings

**Files:**
- Create: `.context-docs/log-redaction.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Full pre-commit checklist**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run test:integration
```
Expected: clean on all four.

- [ ] **Step 2: Write the reference doc**

Create `.context-docs/log-redaction.md` covering: the three leak sources and the measurement that found them; why `errorFormat: "minimal"` does not work; why Prisma logs via `console.log` so patching only `console.error` fails; the never-log list and why `code` is excluded; why there is no entropy matching; the discard-and-summarise decision for Prisma; the production-only console patch and the dev trade-off; and how to add a new sensitive key or pattern.

- [ ] **Step 3: Add the short CLAUDE.md entry**

Under **Security constraints**, a few lines only — per the standing preference that CLAUDE.md stays lean:

- `logError()` / `redact()` in `src/lib/redaction.ts` is the only way application code logs an error; `console-sinks.test.ts` enforces it, with a reasoned allowlist.
- Never pass a raw error to a console method: Prisma embeds the whole failed `data:` object in validation messages.
- Prisma uses event-based error logging in production; `console` is patched in `instrumentation.ts`, production only.
- Adding a sensitive key means updating `SENSITIVE_KEYS` **and** checking it does not collide with a diagnostic field — `code` is excluded for exactly that reason.

Add one line to the **Reference docs** index pointing at `.context-docs/log-redaction.md`.

- [ ] **Step 4: Open, watch, merge**

```bash
git add .context-docs/log-redaction.md CLAUDE.md
git commit -m "docs: record the log-redaction invariants (SECH-115)"
git push -u origin HEAD
gh pr create --base main --body-file /tmp/pr-body.md   # see Step 3a
gh pr checks --watch
gh pr merge --squash --delete-branch
until gh run list --repo jedmond1971/taskforge --branch main --limit 1 2>&1 | grep -qE "completed"; do sleep 10; done
gh run list --repo jedmond1971/taskforge --branch main --limit 1
```
Expected: `completed success`.

- [ ] **Step 5: Post the fix summary to SECH-115 and close it**

Post as Maximus via the production v1 REST API — the MCP connector tools authenticate as Jamie and have no `authorId` override. Use a heredoc, because bash expands backticks inside `"` and inside `python3 -c "..."` alike.

```bash
python3 << 'PYEOF'
import urllib.request, json, os

summary = """
<p><strong>Shipped in two PRs.</strong></p>
<p><strong>What the audit actually found.</strong> The ticket assumed the job was our own
console call sites. Measured against a production build, that is the least dangerous third:
Prisma's own logger prints the full failed <code>data:</code> object and fires even when the
caller catches, and Next.js logs uncaught route errors with the same payload. A marker string
appeared twice per request from those two alone, before any of our code ran.</p>
<p><strong>What changed.</strong> One redactor (<code>src/lib/redaction.ts</code>) with
key-based scrubbing for objects and pattern-based for strings, plus discard-and-summarise for
Prisma errors. Three adapters: Prisma moved to event-based error logging, a production-only
console patch in <code>instrumentation.ts</code>, and <code>logError()</code> replacing 68
call sites across 41 files.</p>
<p><strong>Decisions worth knowing.</strong> <code>errorFormat: "minimal"</code> does not strip
the data block — tested. Prisma logs via <code>console.log</code>, not
<code>console.error</code>, so patching only the latter looks right and is not. Bare
<code>code</code> is deliberately off the sensitive-key list because it collides with Prisma's
P2002, and over-redaction is the failure nobody notices. No entropy matching, because cuids
would match and every id in every log line would vanish.</p>
<p><strong>Tests.</strong> A corpus of real secret shapes, including a verbatim captured Prisma
error, plus a MUST_SURVIVE list guarding against over-redaction, a console-patch suite covering
idempotency and fail-open, and a sink guard verified against a planted canary.</p>
"""

req = urllib.request.Request(
    "https://taskforge-production-099b.up.railway.app/api/v1/issues/SECH-115/comments",
    data=json.dumps({"authorId": "cmo365psl000vdrd0p63lirlz", "body": summary}).encode(),
    method="POST",
    headers={"X-Internal-Api-Key": os.environ["V1_API_KEY"], "Content-Type": "application/json"},
)
print(urllib.request.urlopen(req).status)

req = urllib.request.Request(
    "https://taskforge-production-099b.up.railway.app/api/v1/issues/SECH-115",
    data=json.dumps({"statusId": "Done"}).encode(), method="PATCH",
    headers={"X-Internal-Api-Key": os.environ["V1_API_KEY"], "Content-Type": "application/json"})
print(json.load(urllib.request.urlopen(req)).get("issue", {}).get("status", {}).get("name"))
PYEOF
```
