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

/** Working days in `[start, end]` inclusive, at least 1. */
export function businessDaysInclusive(start: Date, end: Date): number {
  let count = 0;
  const day = new Date(start);
  while (day <= end) {
    if (!isWeekend(day)) count++;
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return Math.max(count, 1);
}

/** The day after `date`, rolled forward to Monday when that lands on a weekend. */
export function nextBusinessDay(date: Date): Date {
  const next = new Date(date);
  do {
    next.setUTCDate(next.getUTCDate() + 1);
  } while (isWeekend(next));
  return next;
}

/** The preset whose length matches `[start, end]`, else `custom`. */
export function inferDuration(start: Date, end: Date): SprintDurationKey {
  const days = businessDaysInclusive(start, end);
  const match = (Object.entries(SPRINT_DURATIONS) as [keyof typeof SPRINT_DURATIONS, { businessDays: number }][]).find(
    ([, d]) => d.businessDays === days
  );
  // A preset only counts if it also ends where the preset would — a 10-working-day
  // span that starts on a weekend is not what the 2-week preset would produce.
  return match && !isWeekend(start) && sprintEndDate(start, days).getTime() === end.getTime() ? match[0] : "custom";
}

type DateLike = Date | string | null;
const time = (d: DateLike) => (d ? new Date(d).getTime() : Number.POSITIVE_INFINITY);

export interface OrderableSprint {
  status: string;
  position: number | null;
  startDate: DateLike;
  createdAt: DateLike;
}

/**
 * Display order of a project's open sprints. Until anyone drags one (no sprint has a
 * `position`), the active sprint leads and the rest follow by start date; after a drag
 * the stored positions rule, with unpositioned stragglers last.
 */
export function orderSprints<T extends OrderableSprint>(sprints: T[]): T[] {
  const byDefault = (a: T, b: T) =>
    Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") ||
    time(a.startDate) - time(b.startDate) ||
    time(a.createdAt) - time(b.createdAt);
  const manual = sprints.some((s) => s.position !== null);
  return [...sprints].sort((a, b) =>
    manual ? (a.position ?? Infinity) - (b.position ?? Infinity) || byDefault(a, b) : byDefault(a, b)
  );
}

export interface DatedSprint {
  id: string;
  startDate: Date | null;
  endDate: Date | null;
}

/**
 * Re-flows the sprints after `editedId` (in display order) so each starts on the next
 * business day after the previous one ends, keeping its length in working days.
 * Returns only the sprints whose dates actually change; sprints without dates are skipped.
 */
export function planFollowingShifts(
  ordered: DatedSprint[],
  editedId: string,
  editedEnd: Date
): { id: string; startDate: Date; endDate: Date }[] {
  const idx = ordered.findIndex((s) => s.id === editedId);
  if (idx === -1) return [];
  const shifts: { id: string; startDate: Date; endDate: Date }[] = [];
  let prevEnd = editedEnd;
  for (const s of ordered.slice(idx + 1)) {
    if (!s.startDate || !s.endDate) continue;
    const startDate = nextBusinessDay(prevEnd);
    const endDate = sprintEndDate(startDate, businessDaysInclusive(s.startDate, s.endDate));
    if (startDate.getTime() !== s.startDate.getTime() || endDate.getTime() !== s.endDate.getTime()) {
      shifts.push({ id: s.id, startDate, endDate });
    }
    prevEnd = endDate;
  }
  return shifts;
}

/** Suggested dates for the next sprint: right after the latest-ending one, same length. */
export function suggestNextSprint(sprints: DatedSprint[]) {
  const dated = sprints.filter((s): s is { id: string; startDate: Date; endDate: Date } => !!s.startDate && !!s.endDate);
  if (dated.length === 0) return null;
  const last = dated.reduce((a, b) => (b.endDate > a.endDate ? b : a));
  const startDate = nextBusinessDay(last.endDate);
  const days = businessDaysInclusive(last.startDate, last.endDate);
  return {
    duration: inferDuration(last.startDate, last.endDate),
    startDate,
    endDate: sprintEndDate(startDate, days),
  };
}
