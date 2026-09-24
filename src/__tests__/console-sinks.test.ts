import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SECH-115: application code does not call console.* directly.
 *
 * Passing a raw error to console.error prints the whole failed Prisma `data:` object —
 * measured. logError() summarises and redacts instead. Without this guard the next
 * catch block reintroduces the leak and nobody notices until an incident.
 */
const SRC = path.join(__dirname, "..");
const SKIP_PATH = /(__tests__|[/\\]integration[/\\]|test-support)/;

const ALLOWED = new Map<string, string>([
  ["lib/security-events.ts", "the event emitter's single write point"],
  ["instrumentation.ts", "the redaction patch itself must call the real console"],
  // Client components: logError writes server-side via securityEvent, so it would
  // silently do nothing in the browser. Client reporting is SECH-116.
  ["components/notifications/NotificationDropdown.tsx", "client component"],
  ["components/notifications/NotificationBell.tsx", "client component"],
  ["app/(dashboard)/error.tsx", "client error boundary"],
  ["app/(dashboard)/projects/[projectKey]/error.tsx", "client error boundary"],
]);

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

describe("console usage", () => {
  const files = walk(SRC).map((f) => ({ rel: rel(f), text: fs.readFileSync(f, "utf8") }));

  it("scanned a plausible number of files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no console.* outside the allowlist", () => {
    const offenders = files
      .filter(({ rel }) => !ALLOWED.has(rel))
      .flatMap(({ rel, text }) =>
        text
          .split("\n")
          .map((line, i) => [i + 1, line] as const)
          // Matches a bare reference too (`.catch(console.error)`), not just a call.
          .filter(([, l]) => /\bconsole\.(log|warn|error|info|debug)\b/.test(l))
          .filter(([, l]) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
          .map(([n, l]) => `${rel}:${n}: ${l.trim()}`)
      );

    expect(offenders).toEqual([]);
  });

  it("every allowlist entry still exists and still uses console", () => {
    // A stale allowlist entry is a hole waiting for a filename to be reused.
    for (const [file] of ALLOWED) {
      const found = files.find((f) => f.rel === file);
      expect(found, `${file} is allowlisted but missing`).toBeTruthy();
      expect(found!.text).toMatch(/\bconsole\./);
    }
  });
});
