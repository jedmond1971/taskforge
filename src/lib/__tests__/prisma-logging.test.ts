import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SECH-115. Standing up a real PrismaClient here would need a database, so this pins the
 * CONFIGURATION — which is where the leak lives. The behaviour (that an error event
 * yields a summarised record) is covered by redaction.test.ts driving summarizeError
 * directly.
 */
const SRC = fs.readFileSync(path.join(__dirname, "..", "prisma.ts"), "utf8");

describe("prisma logging configuration", () => {
  it("uses event-based error logging in production, not stdout", () => {
    expect(SRC).toMatch(/emit:\s*["']event["']/);
  });

  it("attaches an error handler", () => {
    expect(SRC).toMatch(/\$on\(\s*["']error["']/);
  });

  it("routes the error through summarizeError rather than logging it raw", () => {
    expect(SRC).toMatch(/summarizeError\s*\(/);
    // The raw message must never be handed to a logger from this file.
    expect(SRC).not.toMatch(/console\.(log|warn|error)\([^)]*\bmessage\b/);
  });

  it("keeps the noisy stdout config only behind a development guard", () => {
    // `log: ["error"]` on the production path is the configuration that leaked. The dev
    // path legitimately keeps a plain array, so assert that the ONLY plain array is the
    // dev one (identified by "query") and that production uses the event emitter.
    expect(SRC).toMatch(/NODE_ENV\s*===\s*["']development["']/);
    const plainArrays = SRC.match(/log:\s*\[[^\]{]*\]/g) ?? [];
    expect(plainArrays.every((a) => /query/.test(a))).toBe(true);
    expect(SRC).toMatch(/log:\s*\[\{\s*emit:\s*["']event["']/);
  });
});
