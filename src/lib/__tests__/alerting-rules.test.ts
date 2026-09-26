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
