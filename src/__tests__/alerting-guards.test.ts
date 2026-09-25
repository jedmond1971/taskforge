import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SECURITY_EVENT_SEVERITY, SECURITY_EVENT_TYPES } from "@/lib/security-events";
import { ALERT_RULES } from "@/lib/alerting/rules";

/**
 * SECH-117 guards. A rule that listens to a type that is not in the catalog can never fire,
 * and a critical event nobody alerts on turns "no attack" and "no alert" into the same silence.
 */

const ALERTING_DIR = path.join(__dirname, "..", "lib", "alerting");
const files = fs.readdirSync(ALERTING_DIR).filter((f) => f.endsWith(".ts")).map((f) => ({
  name: f,
  text: fs.readFileSync(path.join(ALERTING_DIR, f), "utf8"),
}));

/** Critical types deliberately NOT alerted on. Empty on purpose — add a reason if that changes. */
const UNALERTED_CRITICAL: Record<string, string> = {};

describe("alert rules vs the security-event catalog", () => {
  it("every rule source is a real catalog type", () => {
    for (const rule of ALERT_RULES) {
      for (const source of rule.sources) {
        expect(SECURITY_EVENT_TYPES as readonly string[], `${rule.id} listens to unknown type ${source}`).toContain(source);
      }
    }
  });

  it("rule ids are unique", () => {
    expect(new Set(ALERT_RULES.map((r) => r.id)).size).toBe(ALERT_RULES.length);
  });

  it("every critical event type is covered by a rule or has a written exception", () => {
    const covered = new Set(ALERT_RULES.flatMap((r) => Array.from(r.sources)));
    const uncovered = SECURITY_EVENT_TYPES.filter(
      (t) => SECURITY_EVENT_SEVERITY[t] === "critical" && !covered.has(t) && !(t in UNALERTED_CRITICAL)
    );
    expect(uncovered, "add an alert rule (rules.ts) or a reasoned entry in UNALERTED_CRITICAL").toEqual([]);
  });
});

describe("alerting subsystem structure", () => {
  it("scanned the subsystem", () => {
    expect(files.map((f) => f.name)).toEqual(expect.arrayContaining(["rules.ts", "config.ts", "store.ts", "index.ts", "deliver.ts", "log.ts", "evaluate.ts"]));
  });

  // app.error / prisma.error feed error_spike: alerting emitting one would feed itself.
  it("no alerting module imports security-events (loop guard)", () => {
    const offenders = files.filter((f) => /from\s+["'][^"']*security-events["']/.test(f.text)).map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  // security-events.ts loads these two on EVERY emit; they must not pull Prisma or Resend in.
  it("rules.ts and config.ts have no imports at all", () => {
    for (const name of ["rules.ts", "config.ts"]) {
      const text = files.find((f) => f.name === name)!.text;
      expect(/^\s*import\s/m.test(text), `${name} must stay import-free`).toBe(false);
    }
  });

  it("only store.ts touches Prisma", () => {
    const offenders = files.filter((f) => f.name !== "store.ts" && /@\/lib\/prisma|@prisma\/client/.test(f.text)).map((f) => f.name);
    expect(offenders).toEqual([]);
  });
});
