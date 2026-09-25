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
