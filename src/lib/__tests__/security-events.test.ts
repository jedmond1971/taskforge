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

  // Review fix 1: userId means ACTOR everywhere; the account acted upon is targetUserId.
  // Without the split, "what did this account do?" returns events it did not cause.
  it("carries targetUserId separately from the actor", () => {
    securityEvent("session.invalidated", { userId: "actor1", targetUserId: "victim1" });
    const rec = emitted();
    expect(rec.userId).toBe("actor1");
    expect(rec.targetUserId).toBe("victim1");
  });

  it("omits absent optional fields rather than emitting nulls", () => {
    securityEvent("csp.violation");
    const rec = emitted();
    expect(rec).not.toHaveProperty("userId");
    expect(rec).not.toHaveProperty("targetUserId");
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
  //
  // SECH-115 changed HOW this is achieved, not whether: redact() now neutralises cycles
  // and BigInts before emit() ever calls JSON.stringify, so the record survives intact
  // instead of collapsing to serializationFailed. emit()'s fallback is kept as defence in
  // depth and is covered directly below. These assert the guarantee, not the mechanism.
  it("does not throw when meta contains a cycle, and keeps the rest of the record", () => {
    const circular: Record<string, unknown> = { keepMe: "visible" };
    circular.self = circular;

    expect(() => securityEvent("auth.login_failed", { meta: circular })).not.toThrow();
    const rec = emitted();
    expect(rec.type).toBe("auth.login_failed");
    const meta = rec.meta as Record<string, unknown>;
    expect(meta.keepMe).toBe("visible");
    expect(meta.self).toBe("[circular]");
  });

  it("does not throw on a BigInt in meta", () => {
    expect(() => securityEvent("apikey.created", { meta: { n: BigInt(1) } })).not.toThrow();
    expect((emitted().meta as Record<string, unknown>).n).toBe("1n");
  });

  it("emit() still degrades rather than throwing if a record somehow will not serialize", () => {
    // Defence in depth: redact() should make this unreachable through securityEvent, but
    // the fallback must keep working, so exercise it by making JSON.stringify throw.
    const realStringify = JSON.stringify;
    const spy = vi.spyOn(JSON, "stringify");
    spy.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    spy.mockImplementation((...args: Parameters<typeof JSON.stringify>) => realStringify(...args));

    expect(() => securityEvent("auth.login_failed", { meta: { a: 1 } })).not.toThrow();
    const rec = emitted();
    expect((rec.meta as Record<string, unknown>).serializationFailed).toBe(true);

    spy.mockRestore();
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
