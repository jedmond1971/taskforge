import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SECH-114: each event type in the catalog has to actually be emitted somewhere.
 *
 * A type declared but never wired is worse than a missing one — SECH-117 writes an
 * alert rule against it, the rule never fires, and the silence reads as "no attacks".
 * Static, like constant-time-secrets.test.ts: it proves the call exists, and the
 * integration suite proves the behaviour.
 */

const SRC = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

/** Each event type, and a file that must emit it. */
const WIRING: Array<{ type: string; file: string }> = [
  { type: "oauth.token_failed", file: "app/api/oauth/token/route.ts" },
  { type: "oauth.refresh_reuse_detected", file: "app/api/oauth/token/route.ts" },
];

describe("security-event wiring", () => {
  it.each(WIRING)("$file emits $type", ({ type, file }) => {
    expect(read(file)).toContain(`"${type}"`);
  });

  // The presented credential must never travel with the failure event.
  it("the OAuth token route never puts a presented secret in an event", () => {
    const src = read("app/api/oauth/token/route.ts");
    const eventLines = src
      .split("\n")
      .filter((l) => /securityEvent\(|clientSecret|code_verifier|refresh_token/.test(l));
    const offending = eventLines.filter((l) =>
      /securityEvent\([^)]*(clientSecret|codeVerifier|refreshTokenValue|plaintext)/.test(l)
    );
    expect(offending).toEqual([]);
  });
});
