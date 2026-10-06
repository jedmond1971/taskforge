// Sprint dates are calendar days, stored as UTC midnight. All arithmetic here is
// UTC so the result never shifts with the server's or browser's timezone.

export const SPRINT_DURATIONS = {
  "2w": { label: "2 weeks", businessDays: 10 },
  "3w": { label: "3 weeks", businessDays: 15 },
  "4w": { label: "4 weeks", businessDays: 20 },
} as const;

export type SprintDurationKey = keyof typeof SPRINT_DURATIONS | "custom";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses `YYYY-MM-DD` into a UTC-midnight Date, or null if it isn't a real calendar day. */
export function parseDateOnly(value: string): Date | null {
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * The last day of a sprint that starts on `start` and spans `businessDays`
 * working days (start day included, Saturdays and Sundays skipped).
 * Wed the 1st + 10 business days ends Tue the 14th.
 */
export function sprintEndDate(start: Date, businessDays: number): Date {
  const end = new Date(start);
  let remaining = businessDays - 1;
  while (remaining > 0) {
    end.setUTCDate(end.getUTCDate() + 1);
    if (!isWeekend(end)) remaining--;
  }
  return end;
}
