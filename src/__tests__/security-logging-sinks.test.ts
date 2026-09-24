import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SECH-114: securityEvent() is the only way a security signal gets written.
 *
 * The value of a structured stream is that it is complete — one console.warn added
 * later is an event SECH-117 can never alert on, and nobody notices until an incident.
 * This is the same guard shape as rich-text-sinks.test.ts.
 */

const SRC = path.join(__dirname, "..");
const SKIP_PATH = /(__tests__|[/\\]integration[/\\]|test-support)/;

/** The one file allowed to write a security event. */
const EMITTER = "lib/security-events.ts";

/** Prefixes that used to mark an ad-hoc security log. None may come back. */
const ADHOC_PREFIXES = [/\[security\]/, /\[csp-report\]/];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (SKIP_PATH.test(full)) continue;
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
const FILES = walk(SRC).map((f) => ({ rel: rel(f), text: fs.readFileSync(f, "utf8") }));

describe("security logging has one sink", () => {
  it("scanned a plausible number of files", () => {
    expect(FILES.length).toBeGreaterThan(50); // canary: the walk actually found the tree
  });

  it("has no ad-hoc [security] or [csp-report] log lines anywhere", () => {
    const offenders = FILES.flatMap(({ rel, text }) =>
      text
        .split("\n")
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => ADHOC_PREFIXES.some((re) => re.test(line)))
        .filter(([, line]) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
        .map(([n, line]) => `${rel}:${n}: ${line.trim()}`)
    );

    expect(offenders).toEqual([]);
  });

  it("only security-events.ts emits the security record", () => {
    const offenders = FILES.filter(
      ({ rel, text }) => rel !== EMITTER && /evt:\s*["']security["']/.test(text)
    ).map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  it("the emitter is the only file calling console.warn with a JSON.stringify payload", () => {
    const offenders = FILES.filter(
      ({ rel, text }) => rel !== EMITTER && /console\.warn\(\s*JSON\.stringify/.test(text)
    ).map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });
});
