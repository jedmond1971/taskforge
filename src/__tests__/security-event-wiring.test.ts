import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SECURITY_EVENT_TYPES } from "@/lib/security-events";

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
  { type: "apikey.created", file: "app/(dashboard)/org-settings/actions.ts" },
  { type: "apikey.revoked", file: "app/(dashboard)/org-settings/actions.ts" },
  { type: "apikey.used_after_revoke", file: "lib/external-api-auth.ts" },
  { type: "session.invalidated", file: "app/(dashboard)/admin/actions.ts" },
  { type: "session.invalidated", file: "app/(dashboard)/settings/actions.ts" },
  { type: "admin.action", file: "lib/audit-log.ts" },
  { type: "upload.rejected", file: "app/api/attachments/presign/route.ts" },
  { type: "upload.rejected", file: "app/api/attachments/upload/route.ts" },
  { type: "upload.rejected", file: "app/api/attachments/confirm/route.ts" },
  { type: "upload.rejected", file: "app/api/editor-images/route.ts" },
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

  it("api-key events carry the id and prefix but never the key or its hash", () => {
    const files = ["app/(dashboard)/org-settings/actions.ts", "lib/external-api-auth.ts"];
    const offending = files.flatMap((f) =>
      read(f)
        .split("\n")
        .map((line, i) => [i + 1, line] as const)
        .filter(([, l]) => /securityEvent\([^)]*(plaintext|hashedKey|incoming)/.test(l))
        .map(([n, l]) => `${f}:${n}: ${l.trim()}`)
    );
    expect(offending).toEqual([]);
  });

  it("the external API returns an identical 401 whether the key is unknown or revoked", () => {
    const src = read("lib/external-api-auth.ts");
    // One shared rejection path: the log distinguishes the cases, the response must not.
    expect(src.match(/status:\s*401/g) ?? []).toHaveLength(2); // missing header + the shared branch
  });
});

const SKIP_PATH = /(__tests__|[/\\]integration[/\\]|test-support|security-events\.ts)/;

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

describe("catalog coverage", () => {
  const ALL_SOURCE = walk(SRC)
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");

  // A type declared but never emitted produces an alert rule that can never fire, and
  // the resulting silence reads as "no attacks". Every catalog entry must be wired.
  it.each(SECURITY_EVENT_TYPES)("%s is emitted somewhere outside the catalog", (type) => {
    expect(ALL_SOURCE).toContain(`"${type}"`);
  });
});
