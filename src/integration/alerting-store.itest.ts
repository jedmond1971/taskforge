import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import * as store from "@/lib/alerting/store";

const MIN = 60_000;
const HOUR = 60 * MIN;

beforeEach(async () => {
  await prisma.alertEvent.deleteMany();
  await prisma.alertState.deleteMany();
});

const ageState = (rule: string, subject: string, ms: number) =>
  prisma.alertState.update({
    where: { rule_subject: { rule, subject } },
    data: { lastSentAt: new Date(Date.now() - ms) },
  });

describe("claimSend", () => {
  it("the first claim wins; a claim inside the cooldown loses and is counted", async () => {
    expect(await store.claimSend("r", "s", HOUR)).toEqual({ claimed: true, suppressed: 0 });
    expect(await store.claimSend("r", "s", HOUR)).toEqual({ claimed: false, suppressed: 0 });
    expect(await store.claimSend("r", "s", HOUR)).toEqual({ claimed: false, suppressed: 0 });
    expect((await prisma.alertState.findUnique({ where: { rule_subject: { rule: "r", subject: "s" } } }))!.suppressedCount).toBe(2);
  });

  it("after the cooldown the next claim wins, reports the prior suppressed count, and resets it", async () => {
    await store.claimSend("r", "s", HOUR);
    await store.claimSend("r", "s", HOUR);
    await store.claimSend("r", "s", HOUR);
    await ageState("r", "s", HOUR + MIN);
    expect(await store.claimSend("r", "s", HOUR)).toEqual({ claimed: true, suppressed: 2 });
    expect((await prisma.alertState.findUnique({ where: { rule_subject: { rule: "r", subject: "s" } } }))!.suppressedCount).toBe(0);
  });

  it("different subjects and rules have independent cooldowns", async () => {
    expect((await store.claimSend("r", "a", HOUR)).claimed).toBe(true);
    expect((await store.claimSend("r", "b", HOUR)).claimed).toBe(true);
    expect((await store.claimSend("other", "a", HOUR)).claimed).toBe(true);
  });

  // Review Focus 3: two instances racing on one cooldown must send exactly once.
  it("concurrent claims produce exactly one winner", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => store.claimSend("race", "s", HOUR)));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
  });
});

describe("backdateClaim", () => {
  // Review Focus 4: a failed send must not silence the rule for the whole cooldown.
  it("lets the next claim through after the retry delay, not before", async () => {
    await store.claimSend("r", "s", HOUR);
    await store.backdateClaim("r", "s", HOUR, 5 * MIN);
    expect((await store.claimSend("r", "s", HOUR)).claimed).toBe(false); // still inside the 5 min retry gap
    await ageState("r", "s", HOUR - 5 * MIN + 6 * MIN); // ...then the retry gap elapses
    expect((await store.claimSend("r", "s", HOUR)).claimed).toBe(true);
  });
});

describe("countInWindow", () => {
  it("counts events for one rule+subject inside the window only", async () => {
    await store.recordObservation("r", "s");
    await store.recordObservation("r", "s");
    await store.recordObservation("r", "other");
    await store.recordObservation("elsewhere", "s");
    const old = await prisma.alertEvent.create({ data: { rule: "r", subject: "s" } });
    await prisma.alertEvent.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 11 * MIN) } });
    expect(await store.countInWindow("r", "s", 10 * MIN, false, 100)).toBe(2);
  });

  it("counts distinct details, so one account failing repeatedly counts once", async () => {
    for (const d of ["a", "a", "a", "b", "c"]) await store.recordObservation("r", "ip", d);
    expect(await store.countInWindow("r", "ip", 10 * MIN, true, 100)).toBe(3);
    // Dedupe-at-write (review I1) already collapsed the repeats, so only 3 rows exist.
    expect(await store.countInWindow("r", "ip", 10 * MIN, false, 100)).toBe(3);
  });
});

describe("countInWindow is capped (review I1)", () => {
  it("never counts past the limit, so a flood costs O(limit) not O(rows)", async () => {
    for (let i = 0; i < 8; i++) await prisma.alertEvent.create({ data: { rule: "r", subject: "s", detail: `d${i}` } });
    expect(await store.countInWindow("r", "s", 10 * MIN, false, 3)).toBe(3);
    expect(await store.countInWindow("r", "s", 10 * MIN, true, 3)).toBe(3);
    expect(await store.countInWindow("r", "s", 10 * MIN, false, 100)).toBe(8);
  });
});

describe("recordObservation dedupes distinct observations (review I1)", () => {
  it("one account failing repeatedly writes one row, not one per attempt", async () => {
    for (let i = 0; i < 5; i++) await store.recordObservation("r", "ip", "same-account");
    await store.recordObservation("r", "ip", "other-account");
    expect(await prisma.alertEvent.count({ where: { rule: "r", subject: "ip" } })).toBe(2);
  });

  it("observations without a detail are never deduped", async () => {
    for (let i = 0; i < 4; i++) await store.recordObservation("r", "global");
    expect(await prisma.alertEvent.count({ where: { rule: "r", subject: "global" } })).toBe(4);
  });

  it("a detail seen only outside the window is recorded again", async () => {
    const old = await prisma.alertEvent.create({ data: { rule: "r", subject: "ip", detail: "a" } });
    await prisma.alertEvent.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 2 * HOUR) } });
    await store.recordObservation("r", "ip", "a", 10 * MIN);
    expect(await prisma.alertEvent.count({ where: { rule: "r", subject: "ip" } })).toBe(2);
  });
});

describe("suppressIfCooling (review I1)", () => {
  it("is false when there is no cooldown row", async () => {
    expect(await store.suppressIfCooling("r", "s", HOUR)).toBe(false);
  });

  it("is true inside the cooldown and counts the swallowed event; false once it has elapsed", async () => {
    await store.claimSend("r", "s", HOUR);
    expect(await store.suppressIfCooling("r", "s", HOUR)).toBe(true);
    expect(await store.suppressIfCooling("r", "s", HOUR)).toBe(true);
    expect((await prisma.alertState.findUnique({ where: { rule_subject: { rule: "r", subject: "s" } } }))!.suppressedCount).toBe(2);
    await ageState("r", "s", HOUR + MIN);
    expect(await store.suppressIfCooling("r", "s", HOUR)).toBe(false);
  });
});

/**
 * Review C1. prisma.ts registers $on("error") → securityEvent("prisma.error"), and prisma.error
 * feeds the error_spike rule. If alerting shared that client, one failed alerting query would
 * emit prisma.error → observe() → another alerting query → ... for as long as the database
 * was unhappy. The store therefore has its own client with no error hook.
 */
describe("alerting DB failures do not re-enter alerting (review C1)", () => {
  const securityTypes = (warn: ReturnType<typeof vi.spyOn>) =>
    warn.mock.calls
      .map(([line]) => { try { return JSON.parse(String(line)); } catch { return null; } })
      .filter((r): r is { evt: string; type: string } => !!r && r.evt === "security")
      .map((r) => r.type);

  it("control: a failing query on the SHARED client does emit prisma.error (the test can see the loop)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(prisma.$queryRawUnsafe("SELECT 1 FROM no_such_table_for_test")).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 100)); // Prisma emits its error event asynchronously
      expect(securityTypes(warn)).toContain("prisma.error");
    } finally {
      warn.mockRestore();
    }
  });

  it("a failing store query emits NO prisma.error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // A real database error from the store's own code path: 'abc' is not a double precision.
      await expect(store.claimSend("r", "s", "abc" as unknown as number)).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 100));
      expect(securityTypes(warn)).not.toContain("prisma.error");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("global cap ledger and pruning", () => {
  it("recordSent / sentInLastHour count only recent sends", async () => {
    await store.recordSent();
    await store.recordSent();
    const old = await prisma.alertEvent.create({ data: { rule: "_sent", subject: "global" } });
    await prisma.alertEvent.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 2 * HOUR) } });
    expect(await store.sentInLastHour()).toBe(2);
  });

  it("prune removes events older than 24h and state older than 7d, keeping the rest", async () => {
    const oldEvt = await prisma.alertEvent.create({ data: { rule: "r", subject: "s" } });
    await prisma.alertEvent.update({ where: { id: oldEvt.id }, data: { createdAt: new Date(Date.now() - 25 * HOUR) } });
    await store.recordObservation("r", "fresh");
    await store.claimSend("old", "s", HOUR);
    await ageState("old", "s", 8 * 24 * HOUR);
    await store.claimSend("new", "s", HOUR);

    await store.prune();

    expect((await prisma.alertEvent.findMany()).map((e) => e.subject)).toEqual(["fresh"]);
    expect((await prisma.alertState.findMany()).map((s) => s.rule)).toEqual(["new"]);
  });
});
