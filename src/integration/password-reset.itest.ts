import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs, flushAfter, setClientIp } from "./session";
import { hashResetToken, issuePasswordResetToken } from "@/lib/password-reset";
import { requestPasswordReset } from "@/app/(auth)/forgot-password/actions";
import { resetPassword } from "@/app/(auth)/reset-password/[token]/actions";
import * as settingsActions from "@/app/(dashboard)/settings/actions";
import * as adminActions from "@/app/(dashboard)/admin/actions";

/**
 * JFR-183: forgot-password / reset-password. Real DB, real actions; only the Resend client is faked so
 * the emailed link can be read back.
 */

type Sent = { to: string; subject: string; html: string };
const sent: Sent[] = [];
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (message: Sent) => {
        sent.push(message);
        return { error: null };
      },
    };
  },
}));

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => { await destroyWorld(w); });

const GENERIC = /if an account exists for that email/i;
const INVALID = /invalid or has expired/i;
const OLD_PASSWORD = "Old-passw0rd!";
const NEW_PASSWORD = "Brand-new-passw0rd!";
// Fixture values, deliberately low-entropy and kept off lines that mention `token`: gitleaks'
// generic-api-key rule reads a high-entropy string next to such words as a leaked credential.
const RACE_PASSWORD_A = "test-test-test-0001";
const RACE_PASSWORD_B = "test-test-test-0002";
const REUSE_PASSWORD = "reuse-reuse-reuse-01";

const created: string[] = [];
async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: { name: `Reset ${label}`, email: `${w.tag}-${label}@itest.local`, passwordHash: await bcrypt.hash(OLD_PASSWORD, 4) },
  });
  created.push(user.id);
  return user;
}
afterAll(async () => { await prisma.user.deleteMany({ where: { id: { in: created } } }); });

const tokenFromEmail = (message: Sent) => /\/reset-password\/([\w-]+)/.exec(message.html)![1];
const lastEmailTo = (address: string) => [...sent].reverse().find((m) => m.to === address);

/** Asks for a reset and returns the raw token from the email that "arrived". */
async function requestAndRead(user: { email: string }) {
  expect(await requestPasswordReset(user.email)).toMatchObject({ success: true });
  await flushAfter();
  const message = lastEmailTo(user.email);
  expect(message).toBeDefined();
  return tokenFromEmail(message!);
}

describe("requestPasswordReset", () => {
  it("answers identically for a registered and an unregistered address, and only emails the real one", async () => {
    const user = await makeUser("req-known");
    const before = sent.length;

    const known = await requestPasswordReset(user.email);
    const unknown = await requestPasswordReset(`${w.tag}-nobody@itest.local`);
    await flushAfter();

    expect(known).toEqual(unknown);
    expect(known).toMatchObject({ success: true, message: expect.stringMatching(GENERIC) });
    expect(sent.length - before).toBe(1);
    expect(sent[sent.length - 1].to).toBe(user.email);
    expect(await prisma.passwordResetToken.count({ where: { user: { email: { contains: "nobody" } } } })).toBe(0);
  });

  it("stores only a hash of the token, with a one-hour expiry, and the link carries the raw token", async () => {
    const user = await makeUser("req-hash");
    const token = await requestAndRead(user);

    const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashResetToken(token));
    expect(rows[0].tokenHash).not.toContain(token);
    const minutes = (rows[0].expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(58);
    expect(minutes).toBeLessThanOrEqual(60);
    expect(lastEmailTo(user.email)!.subject).toMatch(/reset your jedforge password/i);
  });

  it("finds the account whatever the case or surrounding whitespace of what was typed", async () => {
    const user = await makeUser("req-case");
    const before = sent.length;
    await requestPasswordReset(`  ${user.email.toUpperCase()} `);
    await flushAfter();
    expect(sent.length - before).toBe(1);
  });

  it("a newer request invalidates the earlier link", async () => {
    const user = await makeUser("req-replace");
    const first = await requestAndRead(user);
    const second = await requestAndRead(user);

    expect(first).not.toBe(second);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
    expect(await resetPassword(first, NEW_PASSWORD)).toMatchObject({ success: false, error: expect.stringMatching(INVALID) });
    expect(await resetPassword(second, NEW_PASSWORD)).toEqual({ success: true });
  });

  it("rejects a malformed address without counting it or sending anything", async () => {
    const before = sent.length;
    expect(await requestPasswordReset("not-an-email")).toMatchObject({ success: false, error: expect.stringMatching(/valid email/i) });
    expect(await requestPasswordReset("")).toMatchObject({ success: false });
    await flushAfter();
    expect(sent.length).toBe(before);
  });

  it("throttles per email — the same way for a registered and an unregistered address", async () => {
    const user = await makeUser("req-throttle");
    for (const address of [user.email, `${w.tag}-ghost@itest.local`]) {
      for (let i = 0; i < 3; i++) expect(await requestPasswordReset(address)).toMatchObject({ success: true });
      expect(await requestPasswordReset(address)).toMatchObject({ success: false, error: expect.stringMatching(/too many attempts/i) });
    }
    await flushAfter();
  });

  it("throttles per IP, across different addresses", async () => {
    setClientIp("198.51.100.77");
    for (let i = 0; i < 10; i++) {
      expect(await requestPasswordReset(`${w.tag}-ip${i}@itest.local`)).toMatchObject({ success: true });
    }
    expect(await requestPasswordReset(`${w.tag}-ip-extra@itest.local`)).toMatchObject({ success: false, error: expect.stringMatching(/too many attempts/i) });
    await flushAfter();
  });

  it("does not leak the address into the rate-limit table", async () => {
    const user = await makeUser("req-pii");
    await requestPasswordReset(user.email);
    await flushAfter();
    const keys = (await prisma.rateLimitAttempt.findMany({ select: { key: true } })).map((r) => r.key);
    expect(keys.some((k) => k.includes(user.email) || k.includes("req-pii"))).toBe(false);
  });
});

describe("resetPassword", () => {
  it("sets the password, bumps sessionVersion, consumes the token and revokes OAuth tokens", async () => {
    const user = await makeUser("do-reset");
    const client = await prisma.oAuthClient.create({ data: { clientName: `itest-reset-${w.tag}`, redirectUris: ["http://localhost:9/cb"] } });
    try {
      await prisma.oAuthAccessToken.create({
        data: { hashedToken: `h-${w.tag}-reset`, clientId: client.id, userId: user.id, orgId: w.orgA.id, scope: "search:read", expiresAt: new Date(Date.now() + 3_600_000) },
      });
      const token = await requestAndRead(user);
      const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

      expect(await resetPassword(token, NEW_PASSWORD)).toEqual({ success: true });

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(await bcrypt.compare(NEW_PASSWORD, after.passwordHash)).toBe(true);
      expect(await bcrypt.compare(OLD_PASSWORD, after.passwordHash)).toBe(false);
      expect(after.sessionVersion).toBe(before.sessionVersion + 1);
      expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
      const oauth = await prisma.oAuthAccessToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(oauth.revokedAt).not.toBeNull();
    } finally {
      await prisma.oAuthAccessToken.deleteMany({ where: { userId: user.id } });
      await prisma.oAuthClient.delete({ where: { id: client.id } });
    }
  });

  it("works once: reusing the link fails and changes nothing", async () => {
    const user = await makeUser("reuse");
    const token = await requestAndRead(user);
    expect(await resetPassword(token, NEW_PASSWORD)).toEqual({ success: true });
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash;

    expect(await resetPassword(token, REUSE_PASSWORD)).toMatchObject({ success: false, error: expect.stringMatching(INVALID) });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(hash);
  });

  it("two simultaneous submissions of one link: exactly one wins", async () => {
    const user = await makeUser("race");
    const token = await requestAndRead(user);
    const results = await Promise.all([resetPassword(token, RACE_PASSWORD_A), resetPassword(token, RACE_PASSWORD_B)]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion;
    expect(before).toBe(2); // 1 default + exactly one bump
  });

  it("rejects an expired link", async () => {
    const user = await makeUser("expired");
    const token = await requestAndRead(user);
    await prisma.passwordResetToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resetPassword(token, NEW_PASSWORD)).toMatchObject({ success: false, error: expect.stringMatching(INVALID) });
    expect(await bcrypt.compare(OLD_PASSWORD, (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash)).toBe(true);
  });

  it("gives an unknown token the same answer as an expired one", async () => {
    const result = await resetPassword("not-a-real-token", NEW_PASSWORD);
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(INVALID) });
  });

  it("a too-short or too-long password is refused without burning the link", async () => {
    const user = await makeUser("policy");
    const token = await requestAndRead(user);
    expect(await resetPassword(token, "short")).toMatchObject({ success: false, error: expect.stringMatching(/at least 8/i) });
    expect(await resetPassword(token, "x".repeat(129))).toMatchObject({ success: false, error: expect.stringMatching(/at most 128/i) });
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
    expect(await resetPassword(token, NEW_PASSWORD)).toEqual({ success: true });
  });

  it("caps attempts per token", async () => {
    const user = await makeUser("per-token");
    const token = await requestAndRead(user);
    for (let i = 0; i < 10; i++) await resetPassword(token, "short");
    expect(await resetPassword(token, NEW_PASSWORD)).toMatchObject({ success: false, error: expect.stringMatching(/too many attempts/i) });
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it("locks an IP out after repeated bad tokens, even for a valid one", async () => {
    setClientIp("198.51.100.88");
    const user = await makeUser("per-ip");
    const token = await requestAndRead(user);
    for (let i = 0; i < 10; i++) {
      expect(await resetPassword(`guess-${i}`, NEW_PASSWORD)).toMatchObject({ success: false, error: expect.stringMatching(INVALID) });
    }
    expect(await resetPassword(token, NEW_PASSWORD)).toMatchObject({ success: false, error: expect.stringMatching(/too many attempts/i) });
  });

  it("does not log anyone in", async () => {
    const user = await makeUser("no-login");
    const token = await requestAndRead(user);
    const result = await resetPassword(token, NEW_PASSWORD);
    expect(result).toEqual({ success: true });
    expect(Object.keys(result)).toEqual(["success"]);
  });
});

describe("other password changes retire outstanding reset links", () => {
  it("changePassword", async () => {
    const user = await makeUser("chg");
    const token = await requestAndRead(user);
    actAs({ id: user.id, name: user.name, email: user.email, role: "TEAM_MEMBER", orgId: w.orgA.id });
    expect(await settingsActions.changePassword(OLD_PASSWORD, "Changed-passw0rd!")).toMatchObject({ success: true });
    expect(await resetPassword(token, NEW_PASSWORD)).toMatchObject({ success: false, error: expect.stringMatching(INVALID) });
  });

  it("adminResetUserPassword", async () => {
    const user = await makeUser("adm");
    const admin = await prisma.user.create({ data: { name: "root-pw-reset", email: `${w.tag}-root-pw@itest.local`, passwordHash: "x", role: "ADMIN" } });
    created.push(admin.id);
    const token = await requestAndRead(user);
    actAs({ id: admin.id, name: admin.name, email: admin.email, role: "ADMIN", orgId: w.orgA.id });
    expect(await adminActions.adminResetUserPassword(user.id, "Admin-set-passw0rd!")).toMatchObject({ success: true });
    expect(await resetPassword(token, NEW_PASSWORD)).toMatchObject({ success: false, error: expect.stringMatching(INVALID) });
  });
});

describe("token housekeeping", () => {
  it("issuing a token sweeps other users' expired rows", async () => {
    const stale = await makeUser("stale");
    const fresh = await makeUser("fresh");
    await prisma.passwordResetToken.create({ data: { userId: stale.id, tokenHash: `stale-${w.tag}`, expiresAt: new Date(Date.now() - 60_000) } });
    await issuePasswordResetToken(fresh.id);
    expect(await prisma.passwordResetToken.count({ where: { userId: stale.id } })).toBe(0);
    expect(await prisma.passwordResetToken.count({ where: { userId: fresh.id } })).toBe(1);
  });

  it("deleting a user removes their tokens", async () => {
    const user = await makeUser("cascade");
    await issuePasswordResetToken(user.id);
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
  });
});
