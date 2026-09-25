import { describe, it, expect, beforeEach } from "vitest";
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
    expect(await store.countInWindow("r", "s", 10 * MIN, false)).toBe(2);
  });

  it("counts distinct details, so one account failing repeatedly counts once", async () => {
    for (const d of ["a", "a", "a", "b", "c"]) await store.recordObservation("r", "ip", d);
    expect(await store.countInWindow("r", "ip", 10 * MIN, true)).toBe(3);
    expect(await store.countInWindow("r", "ip", 10 * MIN, false)).toBe(5);
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
