import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SECH-85 definition of done: "every externally reachable route/action appears in the
 * authorization matrix". Adding a route.ts handler or an exported server action without
 * documenting how it authenticates and where its tenant boundary comes from fails here.
 */

const APP_DIR = path.join(__dirname, "..", "app");
const MATRIX = fs.readFileSync(path.join(__dirname, "..", "..", ".context-docs", "authz-matrix.md"), "utf8");
const rel = (f: string) => path.relative(APP_DIR, f).split(path.sep).join("/");

function walk(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, match));
    else if (match(e.name)) out.push(full);
  }
  return out;
}

const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE"];
function methodsOf(source: string): string[] {
  const found = new Set<string>();
  for (const m of Array.from(source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g))) found.add(m[1]);
  for (const m of Array.from(source.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/g))) found.add(m[1]);
  // export const { GET, POST } = handlers  (NextAuth)
  for (const m of Array.from(source.matchAll(/export\s+const\s+\{([^}]*)\}/g))) {
    for (const name of m[1].split(",").map((n) => n.trim())) if (METHOD_ORDER.includes(name)) found.add(name);
  }
  return METHOD_ORDER.filter((m) => found.has(m));
}

describe("authorization matrix covers every route", () => {
  const routes = walk(APP_DIR, (n) => n === "route.ts");
  it("found routes", () => expect(routes.length).toBeGreaterThan(30));

  for (const file of routes) {
    it(`${rel(file)} is listed with all of its methods`, () => {
      const row = MATRIX.split("\n").find((l) => l.startsWith(`| \`${rel(file)}\` |`));
      expect(row, `add a row for \`${rel(file)}\` to .context-docs/authz-matrix.md`).toBeDefined();
      const listed = row!.split("|")[2].split(",").map((m) => m.trim());
      expect(listed).toEqual(methodsOf(fs.readFileSync(file, "utf8")));
    });
  }

  it("lists no route that no longer exists", () => {
    const existing = new Set(routes.map(rel));
    const listed = Array.from(MATRIX.matchAll(/^\| `([^`]+\/route\.ts)` \|/gm)).map((m) => m[1]);
    for (const p of listed) expect(existing.has(p), `stale matrix row: ${p}`).toBe(true);
  });
});

describe("authorization matrix covers every server action", () => {
  const files = walk(APP_DIR, (n) => /actions?\.ts$|-actions\.ts$/.test(n)).filter((f) => fs.readFileSync(f, "utf8").includes("use server"));
  it("found action files", () => expect(files.length).toBeGreaterThan(10));

  for (const file of files) {
    it(`${rel(file)} lists every exported action`, () => {
      const heading = `### \`${rel(file)}\``;
      const start = MATRIX.indexOf(heading);
      expect(start, `add a "${heading}" section to .context-docs/authz-matrix.md`).toBeGreaterThan(-1);
      const rest = MATRIX.slice(start + heading.length);
      const next = rest.search(/^#{2,3} /m);
      const section = next === -1 ? rest : rest.slice(0, next);
      const names = Array.from(fs.readFileSync(file, "utf8").matchAll(/export\s+async\s+function\s+(\w+)/g)).map((m) => m[1]);
      for (const name of names) {
        expect(section, `add \`${name}\` under ${heading}`).toContain(`| \`${name}\` |`);
      }
    });
  }
});
