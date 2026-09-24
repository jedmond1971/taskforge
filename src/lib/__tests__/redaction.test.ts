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
