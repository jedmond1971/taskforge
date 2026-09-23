#!/usr/bin/env node
/**
 * SECH-104 — dependency-audit gate.
 *
 * Fails CI when `npm audit` reports a high or critical advisory that has not
 * been formally accepted in the security risk register (SECH-103). Accepted
 * advisories live in `.security/audit-allowlist.json`, each carrying the
 * register id and an expiry date; once that date passes the gate goes red
 * again, so a time-boxed acceptance cannot quietly become permanent.
 *
 * Deliberately dependency-free plain ESM: `npm audit` resolves the tree from
 * `package-lock.json` alone, so the CI job needs no `npm ci` step and there is
 * nothing in the gate's own supply chain to compromise the gate.
 *
 * Usage:
 *   node scripts/audit-gate.mjs                     # production deps, gates CI
 *   node scripts/audit-gate.mjs --include-dev       # full tree (weekly audit)
 *   node scripts/audit-gate.mjs --report out.json   # also write the raw report
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

/** Severities that block a build unless explicitly accepted. */
const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_PATH = path.join(REPO_ROOT, ".security", "audit-allowlist.json");

/**
 * Pull the GitHub advisory id out of an npm audit `via` entry.
 * Falls back to the numeric npm source id when the URL isn't a GHSA link.
 */
function advisoryId(via) {
  const match = /GHSA-[0-9a-z-]+/i.exec(via.url ?? "");
  if (match) return match[0];
  return via.source != null ? `npm-${via.source}` : null;
}

/**
 * Flatten an npm audit v2 report into one entry per distinct advisory,
 * recording every package it was reported against.
 */
function collectAdvisories(report) {
  if (!report || typeof report !== "object" || !report.vulnerabilities) {
    throw new Error(
      "Unrecognised npm audit report: expected an object with a `vulnerabilities` key.",
    );
  }

  const byId = new Map();

  for (const [pkgName, vuln] of Object.entries(report.vulnerabilities)) {
    // `via` mixes advisory objects with plain strings naming the upstream
    // package that a transitive vulnerability flows through. Only the objects
    // are real advisories; the strings would double-count them.
    for (const via of vuln?.via ?? []) {
      if (typeof via !== "object" || via === null) continue;

      const id = advisoryId(via);
      if (!id) continue;

      const existing = byId.get(id);
      if (existing) {
        if (!existing.packages.includes(pkgName)) existing.packages.push(pkgName);
        continue;
      }

      byId.set(id, {
        ghsa: id,
        severity: via.severity ?? "unknown",
        title: via.title ?? "",
        url: via.url ?? "",
        range: via.range ?? "",
        packages: [pkgName],
      });
    }
  }

  return [...byId.values()];
}

/**
 * Validate one allowlist entry and return its expiry as a timestamp.
 * An entry is only meaningful if it names the register decision it mirrors and
 * the date that decision runs out, so both are required rather than defaulted.
 */
function expiryTimestamp(entry) {
  if (!entry || typeof entry !== "object" || !entry.ghsa) {
    throw new Error("Allowlist entry is missing a `ghsa` advisory id.");
  }
  if (!entry.riskId) {
    throw new Error(
      `Allowlist entry ${entry.ghsa} is missing a \`riskId\` — every accepted advisory must cite its risk-register entry.`,
    );
  }
  if (!entry.expires) {
    throw new Error(
      `Allowlist entry ${entry.ghsa} is missing an \`expires\` date — acceptances must be time-boxed.`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
    throw new Error(
      `Allowlist entry ${entry.ghsa} has an unparseable \`expires\` value (${entry.expires}); use YYYY-MM-DD.`,
    );
  }

  // Valid through the end of the stated day, UTC.
  const ts = Date.parse(`${entry.expires}T23:59:59.999Z`);
  if (Number.isNaN(ts)) {
    throw new Error(
      `Allowlist entry ${entry.ghsa} has an unparseable \`expires\` value (${entry.expires}).`,
    );
  }
  return ts;
}

/**
 * Decide whether an audit report passes the gate.
 *
 * @param report   Parsed `npm audit --json` output (v2 schema).
 * @param allowlist Parsed `.security/audit-allowlist.json` contents.
 * @param now      Clock, injected so expiry behaviour is testable.
 * @returns `{ ok, blocking, expired, suppressed, stale }`
 */
export function evaluateAudit(report, allowlist, now = new Date()) {
  const advisories = collectAdvisories(report);
  const entries = (allowlist ?? []).map((entry) => ({
    entry,
    expiresAt: expiryTimestamp(entry),
  }));
  const byGhsa = new Map(entries.map((e) => [e.entry.ghsa, e]));
  const nowTs = now.getTime();

  const blocking = [];
  const expired = [];
  const suppressed = [];

  for (const advisory of advisories) {
    if (!BLOCKING_SEVERITIES.has(advisory.severity)) continue;

    const accepted = byGhsa.get(advisory.ghsa);
    if (!accepted) {
      blocking.push(advisory);
    } else if (nowTs > accepted.expiresAt) {
      expired.push({ ...advisory, ...accepted.entry });
    } else {
      suppressed.push({ ...advisory, ...accepted.entry });
    }
  }

  // An acceptance that has run out but whose advisory is no longer in the tree
  // has nothing left to re-decide — it's dead weight, worth a warning but not a
  // red build.
  const present = new Set(advisories.map((a) => a.ghsa));
  const stale = entries
    .filter((e) => nowTs > e.expiresAt && !present.has(e.entry.ghsa))
    .map((e) => e.entry);

  return {
    ok: blocking.length === 0 && expired.length === 0,
    blocking,
    expired,
    suppressed,
    stale,
  };
}

function readAllowlist() {
  try {
    return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw new Error(`Could not read ${ALLOWLIST_PATH}: ${err.message}`);
  }
}

function runNpmAudit({ includeDev }) {
  const args = ["audit", "--json"];
  if (!includeDev) args.push("--omit=dev");

  let stdout;
  try {
    stdout = execFileSync("npm", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // `npm audit` exits non-zero whenever it finds anything at all; the report
    // is still on stdout and is what we actually want to judge.
    stdout = err.stdout;
    if (!stdout) {
      throw new Error(`npm audit produced no report: ${err.stderr || err.message}`);
    }
  }
  return stdout;
}

function describe(advisory) {
  const where = advisory.packages.join(", ");
  return `  ${advisory.severity.toUpperCase().padEnd(8)} ${advisory.ghsa}  ${where}\n            ${advisory.title}`;
}

function main(argv) {
  const includeDev = argv.includes("--include-dev");
  const reportFlag = argv.indexOf("--report");
  const reportPath = reportFlag !== -1 ? argv[reportFlag + 1] : null;

  const raw = runNpmAudit({ includeDev });
  if (reportPath) writeFileSync(reportPath, raw);

  const result = evaluateAudit(JSON.parse(raw), readAllowlist(), new Date());
  const scope = includeDev ? "all dependencies" : "production dependencies";

  console.log(`Dependency audit gate — ${scope}, failing on high/critical.\n`);

  if (result.suppressed.length > 0) {
    console.log("Accepted (risk register, not yet expired):");
    for (const a of result.suppressed) {
      console.log(`${describe(a)}\n            accepted as ${a.riskId}, expires ${a.expires}`);
    }
    console.log("");
  }

  if (result.stale.length > 0) {
    console.log("::warning::Allowlist entries have expired but their advisories are gone — remove them:");
    for (const e of result.stale) {
      console.log(`  ${e.ghsa} (${e.riskId}, expired ${e.expires})`);
    }
    console.log("");
  }

  if (result.expired.length > 0) {
    console.log("::error::Accepted advisories are still present and their acceptance has expired:");
    for (const a of result.expired) {
      console.log(`${describe(a)}\n            ${a.riskId} expired ${a.expires} — upgrade, or renew the decision in the risk register.`);
    }
    console.log("");
  }

  if (result.blocking.length > 0) {
    console.log("::error::New high/critical advisories with no recorded acceptance:");
    for (const a of result.blocking) console.log(describe(a));
    console.log(
      `\nFix the dependency, or record an acceptance in the risk register and mirror it in ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}.`,
    );
    console.log("");
  }

  if (result.ok) {
    console.log("PASS — no unaccepted high or critical advisories.");
    return 0;
  }
  console.log("FAIL — see above.");
  return 1;
}

// Only act when executed directly; importing this module (tests) must be inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    // Fail closed: an unreadable report or a malformed allowlist must not be
    // mistaken for a clean tree.
    console.error(`::error::Dependency audit gate could not complete: ${err.message}`);
    process.exit(1);
  }
}
