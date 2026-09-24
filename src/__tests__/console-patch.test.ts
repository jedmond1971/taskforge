import { describe, it, expect, vi, beforeEach } from "vitest";
import { installConsoleRedaction } from "@/instrumentation";

/**
 * Returns the console-like object AND the underlying spies.
 *
 * installConsoleRedaction REPLACES each method with a wrapper, so after patching
 * `c.log` is the wrapper and `c.log.mock` is undefined. The wrapper calls the original
 * (captured and bound before patching), so the spies still record — assert on those.
 */
function fakeConsole() {
  const spies = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { c: { ...spies } as { log: typeof spies.log; warn: typeof spies.warn; error: typeof spies.error }, spies };
}

beforeEach(() => vi.clearAllMocks());

describe("console redaction patch", () => {
  // Prisma logs via console.log, so patching only console.error looks right and is not.
  it.each(["log", "warn", "error"] as const)("patches console.%s", (method) => {
    const { c } = fakeConsole();
    const spy = c[method];
    installConsoleRedaction(c, "production");
    c[method]("Authorization: Bearer sk-live-abcdef0123456789");
    expect(String(spy.mock.calls[0][0])).not.toContain("sk-live-abcdef0123456789");
  });

  it("redacts object arguments too", () => {
    const { c, spies } = fakeConsole();
    installConsoleRedaction(c, "production");
    c.error("ctx", { passwordHash: "$2a$12$abcdefghij" });
    expect(JSON.stringify(spies.error.mock.calls[0])).not.toContain("$2a$12$abcdefghij");
  });

  it("leaves ordinary lines alone", () => {
    const { c, spies } = fakeConsole();
    installConsoleRedaction(c, "production");
    c.log("Ready in 93ms");
    expect(spies.log.mock.calls[0][0]).toBe("Ready in 93ms");
  });

  it("does not truncate a long ordinary log line", () => {
    // redact()'s cap is opt-in; the patch must not pass it, or every long production
    // log line would be silently truncated.
    const { c, spies } = fakeConsole();
    installConsoleRedaction(c, "production");
    const long = "y".repeat(5000);
    c.log(long);
    expect(String(spies.log.mock.calls[0][0]).length).toBe(5000);
  });

  it("is a no-op outside production", () => {
    const { c, spies } = fakeConsole();
    installConsoleRedaction(c, "development");
    c.log("Authorization: Bearer sk-live-abcdef0123456789");
    expect(spies.log.mock.calls[0][0]).toContain("sk-live-abcdef0123456789");
  });

  // Review Focus 4: a second install must not wrap the wrapper.
  it("is idempotent", () => {
    const { c } = fakeConsole();
    installConsoleRedaction(c, "production");
    const afterFirst = c.log;
    installConsoleRedaction(c, "production");
    expect(c.log).toBe(afterFirst);
  });

  // Review Focus 2 and 3: the patch must neither swallow a line nor re-enter itself.
  it("falls open and logs the original when redaction throws", () => {
    const { c, spies } = fakeConsole();
    const exploding = {
      get boom(): string {
        throw new Error("nope");
      },
      toString() {
        throw new Error("nope");
      },
    };
    installConsoleRedaction(c, "production");
    expect(() => c.error("ctx", exploding)).not.toThrow();
    expect(spies.error).toHaveBeenCalled();
  });

  it("calls the original exactly once per invocation, never re-entering", () => {
    const { c, spies } = fakeConsole();
    installConsoleRedaction(c, "production");
    c.log("outer");
    c.log("inner");
    expect(spies.log).toHaveBeenCalledTimes(2);
  });
});
