import { describe, it, expect } from "vitest";
import { parseDateOnly, formatDateOnly, isWeekend, sprintEndDate } from "@/lib/sprint-dates";

const d = (s: string) => parseDateOnly(s)!;

describe("sprintEndDate", () => {
  it("2 weeks from Wed the 1st ends Tue the 14th (the JFR-189 example)", () => {
    // 2026-04-01 is a Wednesday
    expect(formatDateOnly(sprintEndDate(d("2026-04-01"), 10))).toBe("2026-04-14");
  });

  it("2 weeks from a Monday ends the Friday of the following week", () => {
    expect(formatDateOnly(sprintEndDate(d("2026-10-05"), 10))).toBe("2026-10-16");
  });

  it("3 weeks = 15 and 4 weeks = 20 business days", () => {
    expect(formatDateOnly(sprintEndDate(d("2026-10-05"), 15))).toBe("2026-10-23");
    expect(formatDateOnly(sprintEndDate(d("2026-10-05"), 20))).toBe("2026-10-30");
  });

  it("a one-day sprint ends on its start day", () => {
    expect(formatDateOnly(sprintEndDate(d("2026-10-07"), 1))).toBe("2026-10-07");
  });

  it("never lands on a weekend", () => {
    for (let i = 0; i < 14; i++) {
      const start = new Date(Date.UTC(2026, 9, 5 + i));
      if (isWeekend(start)) continue;
      expect(isWeekend(sprintEndDate(start, 10))).toBe(false);
    }
  });
});

describe("parseDateOnly", () => {
  it("accepts a real day and rejects junk and impossible dates", () => {
    expect(parseDateOnly("2026-10-06")).not.toBeNull();
    expect(parseDateOnly("2026-02-30")).toBeNull();
    expect(parseDateOnly("10/06/2026")).toBeNull();
    expect(parseDateOnly("")).toBeNull();
  });
});

import {
  businessDaysInclusive,
  nextBusinessDay,
  inferDuration,
  orderSprints,
  planFollowingShifts,
  suggestNextSprint,
} from "@/lib/sprint-dates";

const f = formatDateOnly;

describe("nextBusinessDay", () => {
  it("is the next calendar day midweek and Monday after a Friday or weekend", () => {
    expect(f(nextBusinessDay(d("2026-04-14")))).toBe("2026-04-15"); // Tue → Wed
    expect(f(nextBusinessDay(d("2026-10-16")))).toBe("2026-10-19"); // Fri → Mon
    expect(f(nextBusinessDay(d("2026-10-17")))).toBe("2026-10-19"); // Sat → Mon
  });
});

describe("businessDaysInclusive / inferDuration", () => {
  it("counts working days and recognises presets", () => {
    expect(businessDaysInclusive(d("2026-04-01"), d("2026-04-14"))).toBe(10);
    expect(inferDuration(d("2026-04-01"), d("2026-04-14"))).toBe("2w");
    expect(inferDuration(d("2026-10-05"), d("2026-10-23"))).toBe("3w");
    expect(inferDuration(d("2026-10-05"), d("2026-10-30"))).toBe("4w");
    expect(inferDuration(d("2026-10-05"), d("2026-10-20"))).toBe("custom");
  });
  it("treats a weekend start as custom even with 10 working days", () => {
    expect(inferDuration(d("2026-04-04"), d("2026-04-15"))).toBe("custom");
  });
});

describe("orderSprints", () => {
  const s = (id: string, status: string, start: string | null, position: number | null = null) => ({
    id, status, position, startDate: start, createdAt: "2026-01-01",
  });
  it("defaults to active first, then start date", () => {
    const out = orderSprints([s("c", "PLANNED", "2026-06-01"), s("b", "PLANNED", "2026-05-01"), s("a", "ACTIVE", "2026-04-01")]);
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("lets stored positions override once any sprint has one", () => {
    const out = orderSprints([s("a", "ACTIVE", "2026-04-01", 1), s("b", "PLANNED", "2026-05-01", 0), s("n", "PLANNED", "2026-03-01")]);
    expect(out.map((x) => x.id)).toEqual(["b", "a", "n"]);
  });
});

describe("planFollowingShifts", () => {
  const sp = (id: string, a: string, b: string) => ({ id, startDate: d(a), endDate: d(b) });
  it("moves following sprints to the next business day, keeping their length", () => {
    // S1 Apr 1–14 (extended to Apr 16); S2 Apr 15–28 (10 days); S3 Apr 29–May 12
    const ordered = [sp("1", "2026-04-01", "2026-04-14"), sp("2", "2026-04-15", "2026-04-28"), sp("3", "2026-04-29", "2026-05-12")];
    const out = planFollowingShifts(ordered, "1", d("2026-04-16"));
    expect(out.map((x) => [x.id, f(x.startDate), f(x.endDate)])).toEqual([
      ["2", "2026-04-17", "2026-04-30"],
      ["3", "2026-05-01", "2026-05-14"],
    ]);
  });
  it("returns nothing when the following sprints already line up", () => {
    const ordered = [sp("1", "2026-04-01", "2026-04-14"), sp("2", "2026-04-15", "2026-04-28")];
    expect(planFollowingShifts(ordered, "1", d("2026-04-14"))).toEqual([]);
  });
  it("skips undated sprints and ignores sprints before the edited one", () => {
    const ordered = [sp("0", "2026-03-01", "2026-03-12"), sp("1", "2026-04-01", "2026-04-14"), { id: "x", startDate: null, endDate: null }];
    expect(planFollowingShifts(ordered, "1", d("2026-04-20"))).toEqual([]);
  });
});

describe("suggestNextSprint", () => {
  it("starts after the latest-ending sprint with a matching length", () => {
    const out = suggestNextSprint([
      { id: "a", startDate: d("2026-04-01"), endDate: d("2026-04-14") },
      { id: "b", startDate: d("2026-04-15"), endDate: d("2026-04-28") },
    ])!;
    expect([out.duration, f(out.startDate), f(out.endDate)]).toEqual(["2w", "2026-04-29", "2026-05-12"]);
  });
  it("rolls a Friday end to Monday and returns null with no dated sprints", () => {
    const out = suggestNextSprint([{ id: "a", startDate: d("2026-10-05"), endDate: d("2026-10-16") }])!;
    expect(f(out.startDate)).toBe("2026-10-19");
    expect(suggestNextSprint([{ id: "a", startDate: null, endDate: null }])).toBeNull();
  });
});
