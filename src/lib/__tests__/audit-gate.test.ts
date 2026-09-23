import { describe, expect, test } from "vitest";

// SECH-104: the dependency-audit gate's pure decision function. The CI job is a
// thin wrapper around this, so every pass/fail rule is exercised here rather
// than by pushing branches and watching Actions go red.
import { evaluateAudit } from "../../../scripts/audit-gate.mjs";

/** Build an npm-audit-v2-shaped report from a list of advisories. */
function auditReport(
  advisories: Array<{
    pkg: string;
    ghsa: string;
    severity: string;
    title?: string;
  }>,
) {
  const vulnerabilities: Record<string, unknown> = {};
  for (const a of advisories) {
    const existing = vulnerabilities[a.pkg] as { via: unknown[] } | undefined;
    const via = {
      source: 1234,
      name: a.pkg,
      title: a.title ?? `${a.ghsa} in ${a.pkg}`,
      url: `https://github.com/advisories/${a.ghsa}`,
      severity: a.severity,
      range: "<9.9.9",
    };
    if (existing) {
      existing.via.push(via);
    } else {
      vulnerabilities[a.pkg] = {
        name: a.pkg,
        severity: a.severity,
        isDirect: false,
        via: [via],
        effects: [],
        range: "<9.9.9",
        nodes: [`node_modules/${a.pkg}`],
        fixAvailable: false,
      };
    }
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: {} };
}

const NOW = new Date("2026-09-23T00:00:00Z");

describe("evaluateAudit", () => {
  test("passes on a tree with no advisories at all", () => {
    const result = evaluateAudit(auditReport([]), [], NOW);

    expect(result.ok).toBe(true);
    expect(result.blocking).toEqual([]);
  });

  test("passes when the only advisories are below the high threshold", () => {
    const report = auditReport([
      { pkg: "@tiptap/core", ghsa: "GHSA-cp6q-959q-f8rh", severity: "moderate" },
      { pkg: "left-pad", ghsa: "GHSA-aaaa-bbbb-cccc", severity: "low" },
    ]);

    const result = evaluateAudit(report, [], NOW);

    expect(result.ok).toBe(true);
    expect(result.blocking).toEqual([]);
  });

  test("fails on a critical advisory that is not allowlisted", () => {
    const report = auditReport([
      { pkg: "evil-dep", ghsa: "GHSA-crit-0000-0000", severity: "critical" },
    ]);

    const result = evaluateAudit(report, [], NOW);

    expect(result.ok).toBe(false);
    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0].ghsa).toBe("GHSA-crit-0000-0000");
    expect(result.blocking[0].severity).toBe("critical");
  });

  test("fails on a high advisory that is not allowlisted", () => {
    const report = auditReport([
      { pkg: "risky-dep", ghsa: "GHSA-high-0000-0000", severity: "high" },
    ]);

    const result = evaluateAudit(report, [], NOW);

    expect(result.ok).toBe(false);
    expect(result.blocking.map((b) => b.ghsa)).toEqual(["GHSA-high-0000-0000"]);
  });

  test("passes when a high advisory is allowlisted and the acceptance has not expired", () => {
    const report = auditReport([
      { pkg: "risky-dep", ghsa: "GHSA-high-0000-0000", severity: "high" },
    ]);
    const allowlist = [
      {
        ghsa: "GHSA-high-0000-0000",
        riskId: "R-99",
        severity: "high",
        expires: "2026-12-31",
        reason: "No fix published upstream; not reachable from any request path.",
      },
    ];

    const result = evaluateAudit(report, allowlist, NOW);

    expect(result.ok).toBe(true);
    expect(result.blocking).toEqual([]);
    expect(result.suppressed.map((s) => s.ghsa)).toEqual(["GHSA-high-0000-0000"]);
  });

  test("fails when an allowlisted advisory is still present after its acceptance expired", () => {
    const report = auditReport([
      { pkg: "risky-dep", ghsa: "GHSA-high-0000-0000", severity: "high" },
    ]);
    const allowlist = [
      {
        ghsa: "GHSA-high-0000-0000",
        riskId: "R-99",
        severity: "high",
        expires: "2026-09-22",
        reason: "Time-boxed acceptance.",
      },
    ];

    const result = evaluateAudit(report, allowlist, NOW);

    expect(result.ok).toBe(false);
    expect(result.expired.map((e) => e.ghsa)).toEqual(["GHSA-high-0000-0000"]);
    expect(result.blocking).toEqual([]);
  });

  test("treats the expiry date as valid through its final day", () => {
    const report = auditReport([
      { pkg: "risky-dep", ghsa: "GHSA-high-0000-0000", severity: "high" },
    ]);
    const allowlist = [
      {
        ghsa: "GHSA-high-0000-0000",
        riskId: "R-99",
        severity: "high",
        expires: "2026-09-23",
        reason: "Expires at the end of today.",
      },
    ];

    const result = evaluateAudit(report, allowlist, NOW);

    expect(result.ok).toBe(true);
  });

  test("reports an expired entry whose advisory is gone as stale, without failing", () => {
    const allowlist = [
      {
        ghsa: "GHSA-gone-0000-0000",
        riskId: "R-98",
        severity: "high",
        expires: "2026-09-01",
        reason: "Upgraded away since.",
      },
    ];

    const result = evaluateAudit(auditReport([]), allowlist, NOW);

    expect(result.ok).toBe(true);
    // `stale` returns allowlist entries verbatim, so TS can't infer a shape for
    // them through the untyped .mjs the way it can for the merged findings.
    expect(result.stale.map((s: { ghsa: string }) => s.ghsa)).toEqual([
      "GHSA-gone-0000-0000",
    ]);
    expect(result.expired).toEqual([]);
  });

  test("collapses one advisory affecting many packages into a single finding", () => {
    const report = auditReport([
      { pkg: "@scope/a", ghsa: "GHSA-dupe-0000-0000", severity: "critical" },
      { pkg: "@scope/b", ghsa: "GHSA-dupe-0000-0000", severity: "critical" },
      { pkg: "@scope/c", ghsa: "GHSA-dupe-0000-0000", severity: "critical" },
    ]);

    const result = evaluateAudit(report, [], NOW);

    expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0].packages).toEqual(["@scope/a", "@scope/b", "@scope/c"]);
  });

  test("ignores the package-name strings npm uses for transitive `via` links", () => {
    const report = {
      auditReportVersion: 2,
      vulnerabilities: {
        "downstream-dep": {
          name: "downstream-dep",
          severity: "critical",
          isDirect: true,
          // npm points at the upstream package by name, not by advisory object.
          via: ["upstream-dep"],
          effects: [],
          range: "*",
          nodes: ["node_modules/downstream-dep"],
          fixAvailable: false,
        },
      },
      metadata: {},
    };

    const result = evaluateAudit(report, [], NOW);

    expect(result.ok).toBe(true);
    expect(result.blocking).toEqual([]);
  });

  test("throws when the audit report is not in the expected shape", () => {
    expect(() => evaluateAudit(null, [], NOW)).toThrow(/audit report/i);
    expect(() => evaluateAudit({ auditReportVersion: 2 }, [], NOW)).toThrow(
      /audit report/i,
    );
  });

  test("throws when an allowlist entry has no expiry date", () => {
    const entry = { ghsa: "GHSA-high-0000-0000", riskId: "R-99", reason: "why" };

    expect(() => evaluateAudit(auditReport([]), [entry], NOW)).toThrow(/expires/i);
  });

  test("throws when an allowlist entry has an unparseable expiry date", () => {
    const entry = {
      ghsa: "GHSA-high-0000-0000",
      riskId: "R-99",
      expires: "next tuesday",
      reason: "why",
    };

    expect(() => evaluateAudit(auditReport([]), [entry], NOW)).toThrow(/expires/i);
  });

  test("throws when an allowlist entry cites no risk-register id", () => {
    const entry = {
      ghsa: "GHSA-high-0000-0000",
      expires: "2026-12-31",
      reason: "why",
    };

    expect(() => evaluateAudit(auditReport([]), [entry], NOW)).toThrow(/riskId/i);
  });
});
