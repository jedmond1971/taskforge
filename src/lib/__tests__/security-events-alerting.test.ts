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
