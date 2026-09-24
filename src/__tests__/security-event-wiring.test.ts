import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SECURITY_EVENT_TYPES } from "@/lib/security-events";

/**
 * SECH-114: each event type in the catalog has to actually be emitted somewhere.
 *
 * A type declared but never wired is worse than a missing one — SECH-117 writes an
 * alert rule against it, the rule never fires, and the silence reads as "no attacks".
 * Static, like constant-time-secrets.test.ts: it proves the call exists and that no
 * forbidden identifier is passed to it. Behaviour is proved by the unit tests that drive
 * each emitter directly (authz-denial-events, audit-log-bridge, credential-revocation).
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
  { type: "prisma.error", file: "lib/prisma.ts" },
  { type: "app.error", file: "lib/security-events.ts" },
];

describe("security-event wiring", () => {
  it.each(WIRING)("$file emits $type", ({ type, file }) => {
    expect(read(file)).toContain(`"${type}"`);
  });

  /**
   * Text of every securityEvent(...) call in a file, parens balanced so a MULTI-LINE call
   * is captured whole. The earlier single-line regex silently covered only the one-line
   * call sites, so adding `codeVerifier` to a multi-line meta would not have failed it.
   */
  function securityEventCalls(src: string): string[] {
    const out: string[] = [];
    const needle = "securityEvent(";
    let from = 0;
    for (;;) {
      const start = src.indexOf(needle, from);
      if (start === -1) return out;
      let depth = 0;
      let i = start + needle.length - 1;
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")" && --depth === 0) break;
      }
      out.push(src.slice(start, i + 1));
      from = i + 1;
    }
  }

  /**
   * Identifiers that ARE a presented credential or its digest. Always forbidden.
   */
  const FORBIDDEN_ALWAYS =
    /\b(plaintext|plaintextRefreshToken|hashedKey|hashedToken|clientSecret|client_secret|codeVerifier|code_verifier|passwordHash|newPassword|currentPassword|incomingKey)\b/;

  /**
   * Identifiers that name a DB ROW whose safe fields (id, orgId, familyId) are fine to log
   * but whose whole value is not. Flagged only when passed entire — `refreshToken.familyId`
   * is an id, `refreshToken` on its own is the record.
   */
  const FORBIDDEN_WHOLE = /\b(refreshToken|refresh_token|secret|incoming|token|code)\b(?!\s*[.:])/;

  const violates = (call: string) => FORBIDDEN_ALWAYS.test(call) || FORBIDDEN_WHOLE.test(call);

  it.each([
    "app/api/oauth/token/route.ts",
    "app/(dashboard)/org-settings/actions.ts",
    "lib/external-api-auth.ts",
    "app/(dashboard)/admin/actions.ts",
    "app/(dashboard)/settings/actions.ts",
    "lib/auth.ts",
    "lib/v1-auth.ts",
  ])("%s never passes a credential-bearing identifier to securityEvent", (file) => {
    const offending = securityEventCalls(read(file)).filter(violates);
    expect(offending).toEqual([]);
  });

  it("allows a safe property read off a credential-bearing row", () => {
    // refreshToken.familyId is an id, not the token — the guard must not cry wolf here.
    const safe = `securityEvent("oauth.refresh_reuse_detected", {\n  meta: { familyId: refreshToken.familyId },\n});`;
    expect(securityEventCalls(safe).filter(violates)).toHaveLength(0);
  });

  it("the multi-line guard actually reads past the first line", () => {
    // Canary for the guard itself: a synthetic multi-line call must be caught.
    const synthetic = `securityEvent("oauth.token_failed", {\n  meta: { codeVerifier },\n});`;
    expect(securityEventCalls(synthetic).filter(violates)).toHaveLength(1);
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

describe("upload rejection reasons", () => {
  // Review fix 7: editor-images only instrumented the raster check, so an SVG probe was
  // loud on three routes and silent on the fourth — the stream understated the sweep.
  const ROUTES: Array<{ file: string; reasons: string[] }> = [
    { file: "app/api/attachments/presign/route.ts", reasons: ["mime_type", "size"] },
    { file: "app/api/attachments/upload/route.ts", reasons: ["mime_type", "size", "not_raster_image"] },
    { file: "app/api/attachments/confirm/route.ts", reasons: ["mime_type", "size", "not_raster_image"] },
    { file: "app/api/editor-images/route.ts", reasons: ["mime_type", "size", "not_raster_image"] },
  ];

  it.each(ROUTES)("$file reports every rejection reason it can produce", ({ file, reasons }) => {
    const src = read(file);
    const missing = reasons.filter((r) => !src.includes(`reason: "${r}"`));
    expect(missing).toEqual([]);
  });
});

describe("catalog coverage", () => {
  const ALL_SOURCE = walk(SRC)
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");

  /**
   * Types emitted by an exported helper that lives in the emitter module itself, so the
   * literal never appears at a call site. Each needs its own coverage assertion below —
   * exempting one without replacing the check would be a hole, not a fix.
   */
  const EMITTED_VIA_HELPER = new Map<string, string>([
    ["app.error", "logError() in security-events.ts; call sites say logError(...), not the type"],
  ]);

  // A type declared but never emitted produces an alert rule that can never fire, and
  // the resulting silence reads as "no attacks". Every catalog entry must be wired.
  it.each(SECURITY_EVENT_TYPES.filter((t) => !EMITTED_VIA_HELPER.has(t)))(
    "%s is emitted somewhere outside the catalog",
    (type) => {
      expect(ALL_SOURCE).toContain(`"${type}"`);
    }
  );

  // The replacement check for the helper-emitted types: logError must actually be used
  // widely, or app.error is declared and effectively dead.
  it("logError is used across the application, not just declared", () => {
    const callSites = walk(SRC).filter((f) => /\blogError\s*\(/.test(fs.readFileSync(f, "utf8")));
    expect(callSites.length).toBeGreaterThan(20);
  });
});
