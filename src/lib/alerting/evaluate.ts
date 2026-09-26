import { createHash } from "node:crypto";
import { ALERT_RULES, type AlertRule, type AlertableRecord } from "./rules";

export interface Observation {
  rule: AlertRule;
  subject: string;
  /** Hash prefix used for distinct counting. Never a raw value. */
  detail?: string;
}

/**
 * A 16-hex prefix of the hash of the lowercased value. Enough to count distinct accounts in a
 * 24-hour operational table that is never exported or emailed; not a way to store an address.
 */
export function hashDetail(raw: string): string {
  return createHash("sha256").update(raw.trim().toLowerCase()).digest("hex").slice(0, 16);
}

/** Pure: which rules care about this record, and under what subject. */
export function observationsFor(record: AlertableRecord): Observation[] {
  const out: Observation[] = [];
  for (const rule of ALERT_RULES) {
    if (!rule.sources.includes(record.type)) continue;
    const subject = rule.subject(record);
    if (!subject) continue;
    if (rule.distinctBy) {
      const raw = rule.distinctBy(record);
      if (!raw) continue;
      out.push({ rule, subject, detail: hashDetail(raw) });
    } else {
      out.push({ rule, subject });
    }
  }
  return out;
}

export function isTripped(rule: AlertRule, count: number): boolean {
  return !rule.threshold || count >= rule.threshold.count;
}
