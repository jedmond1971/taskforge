import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: h.send }; } }));

import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs, actAsNobody } from "./session";
import * as adminActions from "@/app/(dashboard)/admin/actions";
import { ALERT_RULES } from "@/lib/alerting/rules";
import { setSendRetryDelaysForTest } from "@/lib/alerting/deliver";
import { resetAlertingWarningsForTest } from "@/lib/alerting/log";

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => { await destroyWorld(w); });

beforeEach(async () => {
  await prisma.alertEvent.deleteMany();
  await prisma.alertState.deleteMany();
  await prisma.rateLimitAttempt.deleteMany({ where: { key: { startsWith: "alert-drill:" } } });
  h.send.mockReset();
  h.send.mockResolvedValue({ data: { id: "e" }, error: null });
  resetAlertingWarningsForTest();
  setSendRetryDelaysForTest([0, 0]); // real delays are 2s and 10s
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
