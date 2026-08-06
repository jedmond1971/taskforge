import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * H-1 (middleware passthrough): src/middleware.ts passes every /api/* request
 * straight through with no auth check of its own — each route.ts is fully
 * responsible for enforcing its own auth. This test is the safety net: it
 * statically scans every route file and fails if a new HTTP method handler
 * ships without calling one of the known guard functions, so a missing guard
 * is caught in CI instead of silently reaching production.
 *
 * Routes that are intentionally public (self-authenticate via a different
 * mechanism, or are inert stubs) must be listed explicitly below with a
 * one-line reason — no route is exempt implicitly.
 */

const API_DIR = path.join(__dirname, "..", "app", "api");

const GUARD_PATTERNS = [
  /const\s+session\s*=\s*await\s+auth\(\)/, // next-auth session, paired with a `!session?.user` 401 check
  /requireV1ApiKey\(/, // internal v1 API shared-secret guard
  /requireExternalApiKey\(/, // customer-facing external API org-key guard
  /requireOAuthToken\(/, // MCP server bearer-token guard
];

const FUNCTION_EXPORT_RE = /export\s+async\s+function\s+(?:GET|POST|PUT|DELETE|PATCH)\b/g;
// Captures the RHS of `export const METHOD = <rhs>` up to `;`/newline, since
// route.ts files sometimes alias several methods to one shared handler
// (e.g. `export const GET = handle; export const POST = handle;`), which
// only needs to be guarded once, not once per alias.
const CONST_EXPORT_RE = /export\s+const\s+(?:GET|POST|PUT|DELETE|PATCH)\s*=\s*([^;\n]*)/g;

/** Number of distinct handler functions a route.ts actually defines. */
function countHandlers(source: string): number {
  const functionCount = Array.from(source.matchAll(FUNCTION_EXPORT_RE)).length;

  const sharedIdentifiers = new Set<string>();
  let inlineHandlerCount = 0;
  for (const match of Array.from(source.matchAll(CONST_EXPORT_RE))) {
    const rhs = match[1].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(rhs)) {
      sharedIdentifiers.add(rhs); // reference to a shared function — dedupe
    } else {
      inlineHandlerCount += 1; // its own inline arrow/function — distinct handler
    }
  }

  return functionCount + sharedIdentifiers.size + inlineHandlerCount;
}

// path relative to API_DIR -> reason it's intentionally unguarded
const PUBLIC_ALLOWLIST: Record<string, string> = {
  "auth/[...nextauth]/route.ts": "NextAuth's own sign-in/callback handler",
  "auth/register/route.ts": "registration is disabled; handler is an inert 403 stub",
  "oauth/register/route.ts": "RFC 7591 dynamic client registration is spec-required to be public",
  "oauth/token/route.ts": "OAuth token endpoint; self-authenticates via client credentials/PKCE, not a session",
};

function findRouteFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findRouteFiles(full));
    } else if (entry.name === "route.ts") {
      files.push(full);
    }
  }
  return files;
}

describe("H-1: every API route enforces auth (or is explicitly allowlisted as public)", () => {
  const routeFiles = findRouteFiles(API_DIR);

  it("found route files to check", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  for (const filePath of routeFiles) {
    const relPath = path.relative(API_DIR, filePath).split(path.sep).join("/");

    it(`${relPath} has a guard for every exported HTTP method`, () => {
      const source = fs.readFileSync(filePath, "utf8");
      const methodCount = countHandlers(source);

      if (methodCount === 0) return; // re-exports handler(s) from elsewhere; nothing to check here

      if (PUBLIC_ALLOWLIST[relPath]) return; // explicitly public, reason recorded above

      const guardCount = GUARD_PATTERNS.reduce(
        (count, pattern) => count + (source.match(new RegExp(pattern, "g"))?.length ?? 0),
        0
      );

      expect(
        guardCount,
        `${relPath} exports ${methodCount} HTTP handler(s) but only ${guardCount} guard call(s) were found. ` +
          `Add a guard (auth()+401 check, requireV1ApiKey, requireExternalApiKey, or requireOAuthToken) to every ` +
          `handler, or add this route to PUBLIC_ALLOWLIST with a reason if it's intentionally public.`
      ).toBeGreaterThanOrEqual(methodCount);
    });
  }

  it("every allowlisted route still exists (no stale entries)", () => {
    for (const relPath of Object.keys(PUBLIC_ALLOWLIST)) {
      const fullPath = path.join(API_DIR, ...relPath.split("/"));
      expect(fs.existsSync(fullPath), `allowlisted route ${relPath} no longer exists`).toBe(true);
    }
  });
});
