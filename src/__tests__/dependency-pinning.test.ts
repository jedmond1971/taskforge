import { describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * SECH-126: every dependency must carry a real version range.
 *
 * `npm ci` resolves from the lockfile, so an unpinned spec looks harmless — CI and Railway
 * builds stay reproducible. The gap is everything else: any `npm install` (adding an unrelated
 * package, a Dependabot rebase, a fresh clone) silently re-resolves an unpinned package to
 * whatever is newest at that moment, with no version gate, no review, and no diff to notice.
 * It also makes the package invisible to Dependabot, since there is no range to bump.
 *
 * `@anthropic-ai/sdk` sat on `"latest"` until this was added.
 */

const pkg = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

/** Specs that resolve to "whatever is newest", rather than to a reviewed version. */
function isUnpinned(spec: string): boolean {
  const s = spec.trim();
  if (s === "" || s === "*" || s === "x" || s === "X") return true;
  if (/^(latest|next|canary|beta|alpha)$/i.test(s)) return true; // dist-tags
  if (/^>=?\s*\d/.test(s)) return true; // open-ended ">=1.0.0"
  return false;
}

describe("dependency pinning", () => {
  const entries = [
    ...Object.entries(pkg.dependencies ?? {}).map(([n, v]) => ["dependencies", n, v] as const),
    ...Object.entries(pkg.devDependencies ?? {}).map(([n, v]) => ["devDependencies", n, v] as const),
  ];

  test("every dependency carries a real version range", () => {
    const offenders = entries
      .filter(([, , spec]) => isUnpinned(spec))
      .map(([section, name, spec]) => `${section}.${name} = ${JSON.stringify(spec)}`);

    expect(offenders).toEqual([]);
  });

  // Guards the guard: if isUnpinned() ever stops recognising these, the test above
  // would pass vacuously no matter what package.json said.
  test.each(["latest", "*", "", "x", ">=1.0.0", "next"])(
    "isUnpinned() recognises %j as unpinned",
    (spec) => {
      expect(isUnpinned(spec)).toBe(true);
    },
  );

  test.each(["^0.115.0", "~1.2.3", "16.3.4", "^3.1034.0"])(
    "isUnpinned() accepts %j as a real range",
    (spec) => {
      expect(isUnpinned(spec)).toBe(false);
    },
  );
});
