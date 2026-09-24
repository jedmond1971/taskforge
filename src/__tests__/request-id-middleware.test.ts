import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SECH-114. src/middleware.ts wraps NextAuth's auth(), so exercising the handler
 * directly means mocking the auth provider. The logic it depends on is pure and
 * unit-tested in request-id.test.ts; what this pins is that middleware actually
 * wires it up, on every return path. Same approach as security-headers.test.ts.
 */
const SRC = fs.readFileSync(path.join(__dirname, "..", "middleware.ts"), "utf8");

describe("middleware request-ID wiring", () => {
  it("imports the helpers rather than rolling its own", () => {
    expect(SRC).toMatch(/from\s+["']@?\/?(\.\/)?lib\/request-id["']/);
    expect(SRC).toMatch(/normalizeRequestId\s*\(/);
  });

  it("never imports node:crypto, which is unavailable on the Edge runtime", () => {
    expect(SRC).not.toMatch(/from\s+["']node:crypto["']/);
    expect(SRC).not.toMatch(/require\(["']crypto["']\)/);
  });

  it("sets the id on the forwarded request headers", () => {
    expect(SRC).toMatch(/requestHeaders\.set\(\s*REQUEST_ID_HEADER/);
  });

  it("applies the id to every response it returns", () => {
    const returns = SRC.match(/return\s+(NextResponse\.|withRequestId\()/g) ?? [];
    expect(returns.length).toBeGreaterThan(0);
    // Every response leaves through the helper that stamps the header.
    const bare = SRC.match(/return\s+NextResponse\./g) ?? [];
    expect(bare).toHaveLength(0);
  });
});
