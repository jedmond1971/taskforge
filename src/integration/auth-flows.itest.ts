import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs, actAsNobody } from "./session";
import { hashOAuthSecret, generateAuthorizationCode } from "@/lib/oauth/tokens";
import * as inviteActions from "@/app/(auth)/invite/[token]/actions";
import * as authorizeActions from "@/app/(auth)/oauth/authorize/actions";
import * as tokenRoute from "@/app/api/oauth/token/route";
import * as registerRoute from "@/app/api/oauth/register/route";

/**
 * SECH-97: the credential-issuing flows — org invites, the OAuth consent screen's server actions,
 * and the public /api/oauth/token + /api/oauth/register endpoints. Each is reachable without (or
 * before) an org membership, so the thing under test is that the credential they hand out is bound
 * to exactly the org/user it was issued for and cannot be replayed, redirected or re-targeted.
 */

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => {
  await prisma.oAuthClient.deleteMany({ where: { clientName: { startsWith: `itest-reg-${w.tag}` } } });
  await destroyWorld(w);
});

const REDIRECT = "http://localhost:9/cb";

// ─── Invites ──────────────────────────────────────────────────────────────────

async function makeInvite(email: string, opts: { orgId?: string; role?: "MEMBER" | "ADMIN"; expired?: boolean; accepted?: boolean } = {}) {
  return prisma.orgInvite.create({
    data: {
      orgId: opts.orgId ?? w.orgA.id,
      email,
      role: opts.role ?? "MEMBER",
      invitedById: w.users.aOwner.id,
      expiresAt: new Date(Date.now() + (opts.expired ? -60_000 : 86_400_000)),
      accepted: !!opts.accepted,
    },
  });
}

describe("acceptInviteNewUser (public — possession of the token)", () => {
  it("creates the user only in the invite's org, with the invite's role, and the token is single-use", async () => {
    const email = `${w.tag}-invitee@itest.local`;
    const invite = await makeInvite(email, { role: "ADMIN" });
    try {
      expect(await inviteActions.acceptInviteNewUser(invite.token, "Invitee", "password123")).toEqual({ success: true });
      const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { orgMembers: true } });
      expect(user.role).toBe("TEAM_MEMBER"); // never a platform role from an invite
      expect(user.orgMembers.map((m) => [m.orgId, m.role])).toEqual([[w.orgA.id, "ADMIN"]]);

      // Replaying the same token (e.g. a leaked link) cannot mint a second account.
      await expect(inviteActions.acceptInviteNewUser(invite.token, "Again", "password123")).resolves.toMatchObject({ success: false, error: expect.stringMatching(/already been used/i) });
      expect(await prisma.user.count({ where: { email: { contains: `${w.tag}-invitee` } } })).toBe(1);
    } finally {
      await prisma.user.deleteMany({ where: { email } });
    }
  });

  it("refuses unknown, expired and already-accepted tokens without creating anything", async () => {
    const expired = await makeInvite(`${w.tag}-expired@itest.local`, { expired: true });
    const used = await makeInvite(`${w.tag}-used@itest.local`, { accepted: true });
    for (const [label, token] of [["unknown", "not-a-token"], ["expired", expired.token], ["accepted", used.token]] as const) {
      expect(await inviteActions.acceptInviteNewUser(token, "x", "password123"), label).toMatchObject({ success: false });
    }
    expect(await prisma.user.count({ where: { email: { in: [`${w.tag}-expired@itest.local`, `${w.tag}-used@itest.local`] } } })).toBe(0);
  });

  it("an invite addressed to an existing account cannot be used to take it over or add it to the org", async () => {
    // Org B's member is invited into Org A; the anonymous path must not set a new password on them.
    const invite = await makeInvite(w.users.bMember.email);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: w.users.bMember.id }, select: { passwordHash: true, name: true } });
    expect(await inviteActions.acceptInviteNewUser(invite.token, "Hijacker", "password123")).toMatchObject({ success: false, error: expect.stringMatching(/already exists/i) });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: w.users.bMember.id }, select: { passwordHash: true, name: true } })).toEqual(before);
    expect(await prisma.orgMember.count({ where: { orgId: w.orgA.id, userId: w.users.bMember.id } })).toBe(0);
    expect((await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })).accepted).toBe(false);
  });
});

describe("acceptInviteExistingUser (session email must match the invite)", () => {
  it("a logged-in user cannot accept an invite addressed to someone else", async () => {
    const invite = await makeInvite(`${w.tag}-someone-else@itest.local`, { role: "ADMIN" });
    actAs(w.users.bMember);
    expect(await inviteActions.acceptInviteExistingUser(invite.token)).toMatchObject({ success: false, error: expect.stringMatching(/different email/i) });
    expect(await prisma.orgMember.count({ where: { orgId: w.orgA.id, userId: w.users.bMember.id } })).toBe(0);
    expect((await prisma.orgInvite.findUniqueOrThrow({ where: { id: invite.id } })).accepted).toBe(false);
  });

  it("no session is refused", async () => {
    const invite = await makeInvite(w.users.bOwner.email);
    actAsNobody();
    expect(await inviteActions.acceptInviteExistingUser(invite.token)).toMatchObject({ success: false });
    expect(await prisma.orgMember.count({ where: { orgId: w.orgA.id, userId: w.users.bOwner.id } })).toBe(0);
  });

  it("control: the addressee (case-insensitively) joins exactly the invite's org, once", async () => {
    const invite = await makeInvite(w.users.bOwner.email.toUpperCase());
    actAs(w.users.bOwner);
    try {
      expect(await inviteActions.acceptInviteExistingUser(invite.token)).toEqual({ success: true });
      const memberships = await prisma.orgMember.findMany({ where: { userId: w.users.bOwner.id }, select: { orgId: true, role: true } });
      expect(memberships).toEqual(expect.arrayContaining([{ orgId: w.orgA.id, role: "MEMBER" }, { orgId: w.orgB.id, role: "OWNER" }]));
      expect(memberships).toHaveLength(2);
      // It grants org membership only — never project membership.
      expect(await prisma.projectMember.count({ where: { userId: w.users.bOwner.id, projectId: w.A.project.id } })).toBe(0);
      expect(await inviteActions.acceptInviteExistingUser(invite.token)).toMatchObject({ success: false, error: expect.stringMatching(/already been used/i) });
    } finally {
      await prisma.orgMember.deleteMany({ where: { orgId: w.orgA.id, userId: w.users.bOwner.id } });
    }
  });
});

// ─── OAuth consent screen ─────────────────────────────────────────────────────

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function consentForm(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// setup.ts turns redirect() into a thrown "NEXT_REDIRECT:<url>".
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

const codeCount = () => prisma.oAuthAuthorizationCode.count({ where: { clientId: w.client.id } });

describe("approveAuthorization / denyAuthorization", () => {
  it("control: issues a code bound to the caller and their chosen org, returned only to the registered redirect_uri", async () => {
    const { challenge } = pkcePair();
    actAs(w.users.bMember);
    const to = await redirectOf(authorizeActions.approveAuthorization(consentForm({
      clientId: w.client.id, redirectUri: REDIRECT, codeChallenge: challenge, scope: "issues:read", state: "s1", orgId: w.orgB.id,
    })));
    const url = new URL(to);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("s1");
    const code = url.searchParams.get("code")!;
    const row = await prisma.oAuthAuthorizationCode.findUniqueOrThrow({ where: { hashedCode: hashOAuthSecret(code) } });
    expect(row).toMatchObject({ userId: w.users.bMember.id, orgId: w.orgB.id, clientId: w.client.id, redirectUri: REDIRECT });
  });

  it("refuses to mint a code for an org the caller does not belong to", async () => {
    const before = await codeCount();
    actAs(w.users.bMember);
    const to = await redirectOf(authorizeActions.approveAuthorization(consentForm({
      clientId: w.client.id, redirectUri: REDIRECT, codeChallenge: pkcePair().challenge, scope: "", orgId: w.orgA.id,
    })));
    expect(new URL(to).searchParams.get("error")).toBe("invalid_request");
    expect(new URL(to).searchParams.get("code")).toBeNull();
    expect(await codeCount()).toBe(before);
  });

  it("never redirects to an unregistered redirect_uri, and skipping PKCE is refused", async () => {
    const before = await codeCount();
    actAs(w.users.bMember);
    const evil = await redirectOf(authorizeActions.approveAuthorization(consentForm({
      clientId: w.client.id, redirectUri: "https://evil.example/cb", codeChallenge: pkcePair().challenge, orgId: w.orgB.id,
    })));
    expect(evil).toBe("/");
    const noPkce = await redirectOf(authorizeActions.approveAuthorization(consentForm({
      clientId: w.client.id, redirectUri: REDIRECT, codeChallenge: "", orgId: w.orgB.id,
    })));
    expect(new URL(noPkce).searchParams.get("error")).toBe("invalid_request");
    expect(await codeCount()).toBe(before);

    // deny is also not an open redirect.
    expect(await redirectOf(authorizeActions.denyAuthorization(consentForm({ redirectUri: "https://evil.example/cb" })))).toBe("/");
    expect(new URL(await redirectOf(authorizeActions.denyAuthorization(consentForm({ redirectUri: REDIRECT, state: "s" })))).searchParams.get("error")).toBe("access_denied");
  });

  it("no session is sent to /login and no code is minted", async () => {
    const before = await codeCount();
    actAsNobody();
    expect(await redirectOf(authorizeActions.approveAuthorization(consentForm({
      clientId: w.client.id, redirectUri: REDIRECT, codeChallenge: pkcePair().challenge, orgId: w.orgB.id,
    })))).toBe("/login");
    expect(await codeCount()).toBe(before);
  });
});

// ─── /api/oauth/token ─────────────────────────────────────────────────────────

function tokenRequest(fields: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

async function makeCode(opts: { userId?: string; orgId?: string; clientId?: string; expired?: boolean } = {}) {
  const { verifier, challenge } = pkcePair();
  const code = generateAuthorizationCode();
  await prisma.oAuthAuthorizationCode.create({
    data: {
      hashedCode: hashOAuthSecret(code),
      clientId: opts.clientId ?? w.client.id,
      userId: opts.userId ?? w.users.bMember.id,
      orgId: opts.orgId ?? w.orgB.id,
      redirectUri: REDIRECT,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      scope: "issues:read",
      expiresAt: new Date(Date.now() + (opts.expired ? -1_000 : 60_000)),
    },
  });
  return { code, verifier };
}

const exchange = (code: string, verifier: string, extra: Record<string, string> = {}) =>
  tokenRoute.POST(tokenRequest({ grant_type: "authorization_code", client_id: w.client.id, code, redirect_uri: REDIRECT, code_verifier: verifier, ...extra }));

const refresh = (refreshToken: string, clientId = w.client.id) =>
  tokenRoute.POST(tokenRequest({ grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken }));

async function tokenRowFor(accessToken: string) {
  return prisma.oAuthAccessToken.findUniqueOrThrow({ where: { hashedToken: hashOAuthSecret(accessToken) } });
}

describe("POST /api/oauth/token — authorization_code", () => {
  it("control: a valid code yields tokens bound to the code's user, org and scope", async () => {
    const { code, verifier } = await makeCode();
    const res = await exchange(code, verifier);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe("issues:read");
    expect(await tokenRowFor(body.access_token)).toMatchObject({ userId: w.users.bMember.id, orgId: w.orgB.id, scope: "issues:read", revokedAt: null });
  });

  it("a code is single-use — a replay gets invalid_grant and no new token", async () => {
    const { code, verifier } = await makeCode();
    expect((await exchange(code, verifier)).status).toBe(200);
    const before = await prisma.oAuthAccessToken.count({ where: { userId: w.users.bMember.id } });
    const replay = await exchange(code, verifier);
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe("invalid_grant");
    expect(await prisma.oAuthAccessToken.count({ where: { userId: w.users.bMember.id } })).toBe(before);
  });

  it("concurrent replays of one code yield at most one token pair", async () => {
    const { code, verifier } = await makeCode();
    const results = await Promise.all([exchange(code, verifier), exchange(code, verifier), exchange(code, verifier)]);
    expect(results.map((r) => r.status).filter((s) => s === 200)).toHaveLength(1);
  });

  it("wrong verifier, wrong redirect_uri, another client, or an expired code are all invalid_grant", async () => {
    const other = await prisma.oAuthClient.create({ data: { clientName: `itest-reg-${w.tag}-other`, redirectUris: [REDIRECT] } });
    const before = await prisma.oAuthAccessToken.count();
    const a = await makeCode();
    expect((await exchange(a.code, pkcePair().verifier)).status).toBe(400);
    expect((await exchange(a.code, a.verifier, { redirect_uri: "http://localhost:9/other" })).status).toBe(400);
    expect((await exchange(a.code, a.verifier, { client_id: other.id })).status).toBe(400);
    const expired = await makeCode({ expired: true });
    expect((await exchange(expired.code, expired.verifier)).status).toBe(400);
    expect((await exchange("not-a-code", a.verifier)).status).toBe(400);
    expect(await prisma.oAuthAccessToken.count()).toBe(before);
    // The original code still works for the rightful client (failed attempts didn't consume it).
    expect((await exchange(a.code, a.verifier)).status).toBe(200);
  });

  it("an unknown client_id or a confidential client with the wrong secret is 401", async () => {
    expect((await tokenRoute.POST(tokenRequest({ grant_type: "authorization_code", client_id: "nope" }))).status).toBe(401);
    const conf = await prisma.oAuthClient.create({
      data: { clientName: `itest-reg-${w.tag}-conf`, redirectUris: [REDIRECT], tokenEndpointAuthMethod: "client_secret_post", clientSecretHash: hashOAuthSecret("right-secret") },
    });
    const { code, verifier } = await makeCode({ clientId: conf.id });
    const base = { grant_type: "authorization_code", client_id: conf.id, code, redirect_uri: REDIRECT, code_verifier: verifier };
    expect((await tokenRoute.POST(tokenRequest(base))).status).toBe(401);
    expect((await tokenRoute.POST(tokenRequest({ ...base, client_secret: "wrong" }))).status).toBe(401);
    const basic = Buffer.from(`${conf.id}:wrong`).toString("base64");
    expect((await tokenRoute.POST(tokenRequest(base, { authorization: `Basic ${basic}` }))).status).toBe(401);
    expect((await tokenRoute.POST(tokenRequest({ ...base, client_secret: "right-secret" }))).status).toBe(200);
  });
});

describe("POST /api/oauth/token — refresh_token", () => {
  async function freshPair() {
    const { code, verifier } = await makeCode();
    return (await exchange(code, verifier)).json() as Promise<{ access_token: string; refresh_token: string }>;
  }

  it("rotates: the new pair keeps the same user/org/scope and the old pair is revoked", async () => {
    const first = await freshPair();
    const res = await refresh(first.refresh_token);
    expect(res.status).toBe(200);
    const second = await res.json();
    expect(await tokenRowFor(second.access_token)).toMatchObject({ userId: w.users.bMember.id, orgId: w.orgB.id, scope: "issues:read", revokedAt: null });
    expect((await tokenRowFor(first.access_token)).revokedAt).not.toBeNull();
    // The old refresh token is dead.
    expect((await refresh(first.refresh_token)).status).toBe(400);
  });

  it("a refresh token cannot be redeemed by another client", async () => {
    const other = await prisma.oAuthClient.create({ data: { clientName: `itest-reg-${w.tag}-thief`, redirectUris: [REDIRECT] } });
    const pair = await freshPair();
    expect((await refresh(pair.refresh_token, other.id)).status).toBe(400);
    expect((await tokenRowFor(pair.access_token)).revokedAt).toBeNull();
    expect(await prisma.oAuthAccessToken.count({ where: { clientId: other.id } })).toBe(0);
  });

  it("concurrent replays of one refresh token yield at most one new pair", async () => {
    const pair = await freshPair();
    const before = await prisma.oAuthAccessToken.count({ where: { userId: w.users.bMember.id } });
    const results = await Promise.all([refresh(pair.refresh_token), refresh(pair.refresh_token), refresh(pair.refresh_token)]);
    expect(results.map((r) => r.status).filter((s) => s === 200)).toHaveLength(1);
    expect(await prisma.oAuthAccessToken.count({ where: { userId: w.users.bMember.id } })).toBe(before + 1);
  });

  it("an unsupported grant type is refused", async () => {
    const res = await tokenRoute.POST(tokenRequest({ grant_type: "client_credentials", client_id: w.client.id }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unsupported_grant_type");
  });
});

// ─── /api/oauth/register ──────────────────────────────────────────────────────

const register = (body: unknown) =>
  registerRoute.POST(new Request("http://localhost/api/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("POST /api/oauth/register (public by spec)", () => {
  it("rejects bodies without redirect_uris", async () => {
    expect((await register({ client_name: `itest-reg-${w.tag}-bad` })).status).toBe(400);
    expect((await register({ client_name: `itest-reg-${w.tag}-bad`, redirect_uris: [] })).status).toBe(400);
    expect(await prisma.oAuthClient.count({ where: { clientName: `itest-reg-${w.tag}-bad` } })).toBe(0);
  });

  it("a public client gets no secret; a confidential one gets a secret that is stored only hashed", async () => {
    const pub = await register({ client_name: `itest-reg-${w.tag}-pub`, redirect_uris: [REDIRECT] });
    expect(pub.status).toBe(201);
    expect((await pub.json()).client_secret).toBeUndefined();

    const conf = await register({ client_name: `itest-reg-${w.tag}-cs`, redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_post" });
    expect(conf.status).toBe(201);
    const body = await conf.json();
    const row = await prisma.oAuthClient.findUniqueOrThrow({ where: { id: body.client_id } });
    expect(body.client_secret).toBeTruthy();
    expect(row.clientSecretHash).toBe(hashOAuthSecret(body.client_secret));
    expect(row.clientSecretHash).not.toBe(body.client_secret);
  });

  it("registering a client grants nothing: it cannot redeem another client's code", async () => {
    const res = await register({ client_name: `itest-reg-${w.tag}-grab`, redirect_uris: [REDIRECT] });
    const { client_id } = await res.json();
    const { code, verifier } = await makeCode(); // issued to w.client, same redirect_uri
    expect((await exchange(code, verifier, { client_id })).status).toBe(400);
    expect(await prisma.oAuthAccessToken.count({ where: { clientId: client_id } })).toBe(0);
  });
});
