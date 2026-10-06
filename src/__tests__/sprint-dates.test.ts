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
