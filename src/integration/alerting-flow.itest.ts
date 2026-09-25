import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: h.send }; } }));

import { prisma } from "@/lib/prisma";
import { observe } from "@/lib/alerting";
import * as store from "@/lib/alerting/store";
import { setSendRetryDelaysForTest } from "@/lib/alerting/deliver";
import { GLOBAL_CAP_PER_HOUR, MAX_IN_FLIGHT } from "@/lib/alerting/rules";
import { resetAlertingWarningsForTest } from "@/lib/alerting/log";

const MIN = 60_000;
const ts = () => new Date().toISOString();

beforeEach(async () => {
  await prisma.alertEvent.deleteMany();
  await prisma.alertState.deleteMany();
  h.send.mockReset();
  h.send.mockResolvedValue({ data: { id: "e" }, error: null });
  resetAlertingWarningsForTest();
  setSendRetryDelaysForTest([0, 0]); // real delays are 2s and 10s
  vi.stubEnv("ALERTING_ENABLED", "true");
  vi.stubEnv("ALERT_EMAIL_TO", "owner@example.test");
  vi.stubEnv("RESEND_API_KEY", "re_test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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
    // React inserts <!-- --> between adjacent text nodes (label, colon, value), so allow them.
    expect(h.send.mock.calls[1][0].html).toMatch(/Suppressed since last alert(?:<!-- -->)?:<\/strong>(?:\s|<!-- -->)*1</);
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

  // Review I1: once a subject is cooling, an attacker's next thousand attempts must not each
  // insert a row, count the window and run the cap/claim queries.
  it("once a subject is cooling, further events do no recording or counting", async () => {
    for (let i = 0; i < 10; i++) await observe(fail(i, "198.51.100.9"));
    expect(h.send).toHaveBeenCalledTimes(1);
    const rowsBefore = await prisma.alertEvent.count({ where: { rule: "login_spray" } });

    for (let i = 10; i < 15; i++) await observe(fail(i, "198.51.100.9"));

    expect(await prisma.alertEvent.count({ where: { rule: "login_spray" } })).toBe(rowsBefore);
    const state = await prisma.alertState.findUnique({ where: { rule_subject: { rule: "login_spray", subject: "198.51.100.9" } } });
    expect(state!.suppressedCount).toBe(5);
    expect(h.send).toHaveBeenCalledTimes(1);
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

// authz_probe is a WARN rule, and reuse() is CRITICAL: the cap only applies to the former.
const denial = (userId: string) => ({ type: "authz.denied_not_member", ts: ts(), userId });
/** Nine recorded denials plus the tenth through observe() = exactly one warn alert. */
async function tripWarn(userId: string) {
  await prisma.alertEvent.createMany({ data: Array.from({ length: 9 }, () => ({ rule: "authz_probe", subject: userId })) });
  await observe(denial(userId));
}
const fillCap = () =>
  prisma.alertEvent.createMany({ data: Array.from({ length: GLOBAL_CAP_PER_HOUR }, () => ({ rule: "_sent", subject: "global" })) });

describe("global cap", () => {
  it("sends the cap's worth of warn alerts, then ONE cap notice, then only logs", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < GLOBAL_CAP_PER_HOUR; i++) await tripWarn(`u${i}`);
    expect(h.send).toHaveBeenCalledTimes(GLOBAL_CAP_PER_HOUR);

    await tripWarn("over1");
    expect(h.send).toHaveBeenCalledTimes(GLOBAL_CAP_PER_HOUR + 1);
    expect(subjects()[GLOBAL_CAP_PER_HOUR]).toBe("[JedForge WARN] Alert cap reached");

    await tripWarn("over2");
    await tripWarn("over3");
    expect(h.send).toHaveBeenCalledTimes(GLOBAL_CAP_PER_HOUR + 1);
    warn.mockRestore();
  });

  it("a cap notice does not itself count toward the cap", async () => {
    for (let i = 0; i < GLOBAL_CAP_PER_HOUR + 1; i++) await tripWarn(`u${i}`);
    expect(await prisma.alertEvent.count({ where: { rule: "_sent" } })).toBe(GLOBAL_CAP_PER_HOUR);
  });

  // Review I2: ten cheap warn alerts must not be able to silence a critical one for an hour.
  it("critical rules are exempt from the cap", async () => {
    await fillCap();
    await observe(reuse("c1"));
    await observe({ type: "admin.role_granted", ts: ts(), userId: "admin1", targetUserId: "u9" });
    expect(subjects()).toEqual([
      "[JedForge CRITICAL] Refresh-token reuse detected",
      "[JedForge CRITICAL] Platform ADMIN role granted",
    ]);
  });

  it("logs a capped warn alert once per rule instead of dropping it silently", async () => {
    await fillCap();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await tripWarn("a");
    await tripWarn("b");
    const capped = warn.mock.calls.filter((c) => c[0] === "[alerting]" && String(c[1]).startsWith("capped:"));
    expect(capped).toHaveLength(1);
    expect(capped[0][1]).toBe("capped:authz_probe");
    warn.mockRestore();
  });
});

describe("send failure", () => {
  const ok = { data: { id: "e" }, error: null };
  const boom = { data: null, error: { message: "boom" } };

  // Review I3: a one-off critical (no cooldown row to backdate, family already revoked) must
  // survive a transient Resend failure.
  it("retries a transient failure inline and still delivers", async () => {
    h.send.mockResolvedValueOnce(boom).mockResolvedValueOnce(ok);
    await observe({ type: "admin.role_granted", ts: ts(), userId: "admin1", targetUserId: "u9" });
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(await prisma.alertEvent.count({ where: { rule: "_sent" } })).toBe(1);
  });

  // Review Focus 4.
  it("after the retries are exhausted: not counted toward the cap, and retried once the gap has elapsed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.send.mockResolvedValue(boom);
    await observe(reuse("u1"));
    expect(h.send).toHaveBeenCalledTimes(3); // the attempt plus two retries
    expect(await prisma.alertEvent.count({ where: { rule: "_sent" } })).toBe(0);

    await observe(reuse("u1")); // inside the retry gap
    expect(h.send).toHaveBeenCalledTimes(3);

    h.send.mockResolvedValue(ok);
    await prisma.alertState.update({
      where: { rule_subject: { rule: "refresh_reuse", subject: "u1" } },
      // The failed send left lastSentAt at ~55 min ago (cooldown 60 − retry 5). Age it past the
      // 60 min cooldown, i.e. the retry gap has elapsed.
      data: { lastSentAt: new Date(Date.now() - 61 * MIN) },
    });
    await observe(reuse("u1"));
    expect(h.send).toHaveBeenCalledTimes(4);
    expect(await prisma.alertEvent.count({ where: { rule: "_sent" } })).toBe(1);
    warn.mockRestore();
  });

  it("never rejects, even if the database throws", async () => {
    const spy = vi.spyOn(store.alertingDb, "$queryRaw").mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(observe(reuse("u1"))).resolves.toBeUndefined();
      expect(warn.mock.calls.some((c) => c[0] === "[alerting]" && c[1] === "observe_failed")).toBe(true);
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
  });
});

// Review C1: bound alerting's own load. An error storm or an outage must not fan out into an
// unbounded number of concurrent alerting operations.
describe("in-flight limit", () => {
  it("drops observations beyond MAX_IN_FLIGHT instead of queueing them without bound", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const claim = vi.spyOn(store, "claimSend").mockImplementation(async () => { await gate; return { claimed: false, suppressed: 0 }; });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const all = Array.from({ length: MAX_IN_FLIGHT + 5 }, (_, i) => observe(reuse(`flood${i}`)));
      await vi.waitFor(() => expect(claim).toHaveBeenCalledTimes(MAX_IN_FLIGHT));
      await new Promise((r) => setTimeout(r, 50)); // the extras had every chance to start
      expect(claim).toHaveBeenCalledTimes(MAX_IN_FLIGHT);
      expect(warn.mock.calls.some((c) => c[0] === "[alerting]" && c[1] === "overloaded")).toBe(true);
      release();
      await Promise.all(all);
    } finally {
      release();
      claim.mockRestore();
      warn.mockRestore();
    }
    // The slots are released: the next observation runs normally.
    await observe(reuse("after"));
    expect(h.send).toHaveBeenCalledTimes(1);
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
