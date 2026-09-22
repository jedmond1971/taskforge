import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { LIMITS } from "@/lib/rate-limit";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs, actAsNobody, setClientIp } from "./session";
import * as registerRoute from "@/app/api/oauth/register/route";
import * as tokenRoute from "@/app/api/oauth/token/route";
import * as authorizeActions from "@/app/(auth)/oauth/authorize/actions";
import * as inviteActions from "@/app/(auth)/invite/[token]/actions";
import * as settingsActions from "@/app/(dashboard)/settings/actions";
import * as orgSettingsActions from "@/app/(dashboard)/org-settings/actions";

/**
 * SECH-107: every sensitive endpoint throttles after its limit, creates nothing while
 * throttled, and recovers once the window passes (simulated by ageing the limiter rows).
 * Real route handlers / Server Actions against a real database. setup.ts clears
 * RateLimitAttempt before each test, so each case starts from an empty budget.
 */

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => {
  await prisma.oAuthClient.deleteMany({ where: { clientName: `itest-rl-${w.tag}` } });
  await prisma.apiKey.deleteMany({ where: { orgId: w.orgA.id, name: { startsWith: "rl-" } } });
  await prisma.orgInvite.deleteMany({ where: { email: { endsWith: `@rl-${w.tag}.itest.local` } } });
  await destroyWorld(w);
});

const REDIRECT = "http://localhost:9/cb";

/** Error message of a `{ success, error }` action result (ActionResult is a discriminated union). */
const errorOf = (r: { success: boolean } & ({ error?: string } | object)) => ("error" in r ? r.error : undefined);

/** Pretend the window has passed for every limiter row whose key starts with `prefix`. */
const ageRows = (prefix: string) =>
  prisma.rateLimitAttempt.updateMany({
    where: { key: { startsWith: prefix } },
    data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
  });

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const m = /^NEXT_REDIRECT:(.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  throw new Error("expected a redirect");
}

describe("POST /api/oauth/register (attempts per IP)", () => {
  const register = (ip: string) =>
    registerRoute.POST(
      new Request("http://localhost/api/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ client_name: `itest-rl-${w.tag}`, redirect_uris: [REDIRECT] }),
      })
    );

  it("allows the limit, then 429 + Retry-After without creating a client, per IP, and recovers", async () => {
    const ip = "198.51.100.10";
    for (let i = 0; i < LIMITS.oauthRegisterPerIp.maxAttempts; i++) expect((await register(ip)).status).toBe(201);
    const before = await prisma.oAuthClient.count({ where: { clientName: `itest-rl-${w.tag}` } });

    const blocked = await register(ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await prisma.oAuthClient.count({ where: { clientName: `itest-rl-${w.tag}` } })).toBe(before);

    expect((await register("198.51.100.11")).status).toBe(201); // other clients unaffected
    await ageRows("oauth-register:");
    expect((await register(ip)).status).toBe(201);
  });
});

describe("POST /api/oauth/token (failures per IP+client and per IP)", () => {
  const token = (ip: string, fields: Record<string, string>) =>
    tokenRoute.POST(
      new Request("http://localhost/api/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
        body: new URLSearchParams(fields),
      })
    );
  const badCode = () => ({
    grant_type: "authorization_code",
    client_id: w.client.id,
    code: randomBytes(16).toString("hex"),
    redirect_uri: REDIRECT,
    code_verifier: "x".repeat(43),
  });

  it("throttles repeated failures for one client from one IP, and recovers", async () => {
    const ip = "198.51.100.20";
    for (let i = 0; i < LIMITS.oauthTokenFailuresPerClientIp.maxAttempts; i++) {
      expect((await token(ip, badCode())).status).toBe(400);
    }
    const blocked = await token(ip, badCode());
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toBe("temporarily_unavailable");

    expect((await token("198.51.100.21", badCode())).status).toBe(400); // other IPs unaffected
    await ageRows("oauth-token");
    expect((await token(ip, badCode())).status).toBe(400);
  });

  it("rotating client_id does not reset the per-IP failure budget", async () => {
    const ip = "198.51.100.22";
    for (let i = 0; i < LIMITS.oauthTokenFailuresPerIp.maxAttempts; i++) {
      const res = await token(ip, { grant_type: "authorization_code", client_id: `nope-${i}` });
      expect(res.status).toBe(401);
    }
    expect((await token(ip, badCode())).status).toBe(429);
  });
});

describe("approveAuthorization (attempts per user)", () => {
  const approve = () =>
    redirectOf(
      authorizeActions.approveAuthorization(
        (() => {
          const fd = new FormData();
          const challenge = createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url");
          for (const [k, v] of Object.entries({
            clientId: w.client.id, redirectUri: REDIRECT, codeChallenge: challenge, scope: "issues:read", state: "s", orgId: w.orgB.id,
          })) fd.set(k, v);
          return fd;
        })()
      )
    );
  const codeCount = () => prisma.oAuthAuthorizationCode.count({ where: { userId: w.users.bMember.id } });

  it("mints codes up to the limit, then redirects with temporarily_unavailable and mints nothing", async () => {
    actAs(w.users.bMember);
    for (let i = 0; i < LIMITS.oauthApprovePerUser.maxAttempts; i++) {
      expect(new URL(await approve()).searchParams.get("code")).toBeTruthy();
    }
    const before = await codeCount();
    const blocked = new URL(await approve());
    expect(blocked.searchParams.get("error")).toBe("temporarily_unavailable");
    expect(blocked.searchParams.get("code")).toBeNull();
    expect(await codeCount()).toBe(before);

    await ageRows("oauth-approve:");
    expect(new URL(await approve()).searchParams.get("code")).toBeTruthy();
  });
});

describe("invite acceptance", () => {
  const makeInvite = (label: string) =>
    prisma.orgInvite.create({
      data: {
        orgId: w.orgA.id,
        email: `${label}@rl-${w.tag}.itest.local`,
        role: "MEMBER",
        invitedById: w.users.aOwner.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

  it("bad tokens are failure-counted per IP; once blocked even a valid invite is refused and nothing is created", async () => {
    actAsNobody();
    setClientIp("198.51.100.30");
    for (let i = 0; i < LIMITS.inviteFailuresPerIp.maxAttempts; i++) {
      const r = await inviteActions.acceptInviteNewUser(`bogus-${i}`, "N", "password123");
      expect(r.error).toBe("This invite link is invalid.");
    }
    const invite = await makeInvite("ip-blocked");
    const blocked = await inviteActions.acceptInviteNewUser(invite.token, "N", "password123");
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/^Too many attempts/);
    expect(await prisma.user.count({ where: { email: invite.email } })).toBe(0);

    setClientIp("198.51.100.31"); // a different client is unaffected
    expect((await inviteActions.acceptInviteNewUser("bogus-x", "N", "password123")).error).toBe("This invite link is invalid.");
  });

  it("one token gets a fixed number of attempts from any IP", async () => {
    actAsNobody();
    const invite = await makeInvite("token-cap");
    for (let i = 0; i < LIMITS.inviteAttemptsPerToken.maxAttempts; i++) {
      setClientIp(`198.51.100.${40 + i}`);
      const r = await inviteActions.acceptInviteNewUser(invite.token, "N", "short"); // fails validation, no user
      expect(r.error).toBe("Password must be at least 8 characters.");
    }
    setClientIp("198.51.100.99");
    expect((await inviteActions.acceptInviteNewUser(invite.token, "N", "password123")).error).toMatch(/^Too many attempts/);
    expect(await prisma.user.count({ where: { email: invite.email } })).toBe(0);
  });

  it("logged-in acceptance is attempt-counted per user", async () => {
    actAs(w.users.bMember);
    for (let i = 0; i < LIMITS.inviteExistingUserPerUser.maxAttempts; i++) {
      expect((await inviteActions.acceptInviteExistingUser(`bogus-${i}`)).error).toBe("This invite link is invalid.");
    }
    expect((await inviteActions.acceptInviteExistingUser("bogus-z")).error).toMatch(/^Too many attempts/);
  });
});

describe("changePassword (wrong-password failures per user)", () => {
  const CORRECT = "correct-horse-battery";

  beforeAll(async () => {
    await prisma.user.update({
      where: { id: w.users.aViewer.id },
      data: { passwordHash: await bcrypt.hash(CORRECT, 4) },
    });
  });

  it("blocks after the limit even with the right password, leaves it unchanged, and recovers", async () => {
    actAs(w.users.aViewer);
    for (let i = 0; i < LIMITS.changePasswordFailuresPerUser.maxAttempts; i++) {
      expect(errorOf(await settingsActions.changePassword(`guess-${i}`, "new-password-1"))).toBe("Current password is incorrect");
    }
    const blocked = await settingsActions.changePassword(CORRECT, "new-password-1");
    expect(blocked.success).toBe(false);
    if (!blocked.success) expect(blocked.error).toMatch(/^Too many attempts/);
    const { passwordHash } = await prisma.user.findUniqueOrThrow({ where: { id: w.users.aViewer.id } });
    expect(await bcrypt.compare(CORRECT, passwordHash)).toBe(true);

    await ageRows("pw-change:");
    expect((await settingsActions.changePassword(CORRECT, "new-password-1")).success).toBe(true);
  });

  it("monitor mode (RATE_LIMIT_MODE=monitor) measures but never blocks", async () => {
    actAs(w.users.aViewer);
    vi.stubEnv("RATE_LIMIT_MODE", "monitor");
    try {
      for (let i = 0; i < LIMITS.changePasswordFailuresPerUser.maxAttempts + 2; i++) {
        expect(errorOf(await settingsActions.changePassword(`guess-${i}`, "x-password-2"))).toBe("Current password is incorrect");
      }
    } finally {
      vi.unstubAllEnvs();
    }
    expect(errorOf(await settingsActions.changePassword("guess-again", "x-password-2"))).toMatch(/^Too many attempts/);
  });
});

describe("createApiKey (attempts per user+org)", () => {
  it("mints keys up to the limit, then refuses without creating one, and recovers", async () => {
    actAs(w.users.aOwner);
    for (let i = 0; i < LIMITS.apiKeyCreatePerUserOrg.maxAttempts; i++) {
      expect((await orgSettingsActions.createApiKey(w.orgA.id, `rl-${i}`)).success).toBe(true);
    }
    const before = await prisma.apiKey.count({ where: { orgId: w.orgA.id } });
    const blocked = await orgSettingsActions.createApiKey(w.orgA.id, "rl-over");
    expect(blocked.success).toBe(false);
    if (!blocked.success) expect(blocked.error).toMatch(/^Too many attempts/);
    expect(await prisma.apiKey.count({ where: { orgId: w.orgA.id } })).toBe(before);

    await ageRows("apikey-create:");
    expect((await orgSettingsActions.createApiKey(w.orgA.id, "rl-after")).success).toBe(true);
  });
});

describe("external API key limiter (durable)", () => {
  const call = async (key: string | null, ip = "198.51.100.60") => {
    const { requireExternalApiKey } = await import("@/lib/external-api-auth");
    return requireExternalApiKey(
      new Request("http://localhost/api/external/v1/x", {
        headers: { ...(key ? { "X-Api-Key": key } : {}), "x-forwarded-for": ip },
      })
    );
  };
  const statusOf = (r: unknown) => (r instanceof Response ? r.status : 200);

  it("limits a key per minute and the limit survives a restart (fresh module, no in-memory state)", async () => {
    for (let i = 0; i < LIMITS.externalApiPerKey.maxAttempts; i++) expect(statusOf(await call(w.apiKeys.a))).toBe(200);
    const blocked = await call(w.apiKeys.a);
    expect(statusOf(blocked)).toBe(429);
    expect(Number((blocked as Response).headers.get("Retry-After"))).toBeGreaterThan(0);

    vi.resetModules(); // what a redeploy/restart did to the old in-memory Map
    expect(statusOf(await call(w.apiKeys.a))).toBe(429);

    expect(statusOf(await call(w.apiKeys.b))).toBe(200); // other keys unaffected
    await ageRows("extapi:");
    expect(statusOf(await call(w.apiKeys.a))).toBe(200);
  });

  it("bad keys are failure-counted per IP, after which even a valid key from that IP is refused", async () => {
    const ip = "198.51.100.61";
    for (let i = 0; i < LIMITS.externalApiAuthFailuresPerIp.maxAttempts; i++) {
      expect(statusOf(await call(i % 2 ? null : w.apiKeys.bRevoked, ip))).toBe(401);
    }
    expect(statusOf(await call(w.apiKeys.a, ip))).toBe(429);
    expect(statusOf(await call(w.apiKeys.a, "198.51.100.62"))).toBe(200);
  });
});
