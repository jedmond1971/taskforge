import { describe, it, expect } from "vitest";
import { getAlertConfig, alertingEnabled } from "@/lib/alerting/config";

describe("getAlertConfig", () => {
  it("is off unless ALERTING_ENABLED is exactly 'true'", () => {
    expect(alertingEnabled({})).toBe(false);
    expect(alertingEnabled({ ALERTING_ENABLED: "1" })).toBe(false);
    expect(alertingEnabled({ ALERTING_ENABLED: "true" })).toBe(true);
  });

  it("is ready only when enabled AND recipient AND Resend key are set", () => {
    const env = { ALERTING_ENABLED: "true", ALERT_EMAIL_TO: "o@example.test", RESEND_API_KEY: "re_x" };
    expect(getAlertConfig(env)).toMatchObject({ enabled: true, ready: true, to: "o@example.test", missing: [] });
  });

  // Review Focus 6: enabled-but-misconfigured must be distinguishable from "quiet".
  it("reports exactly which variable is missing when enabled", () => {
    const cfg = getAlertConfig({ ALERTING_ENABLED: "true" });
    expect(cfg.enabled).toBe(true);
    expect(cfg.ready).toBe(false);
    expect(cfg.missing).toEqual(["ALERT_EMAIL_TO", "RESEND_API_KEY"]);
  });

  it("treats a whitespace-only recipient as missing", () => {
    const cfg = getAlertConfig({ ALERTING_ENABLED: "true", ALERT_EMAIL_TO: "   ", RESEND_API_KEY: "re_x" });
    expect(cfg.missing).toEqual(["ALERT_EMAIL_TO"]);
  });
});
