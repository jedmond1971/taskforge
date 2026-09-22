import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs } from "./session";
import { requireOAuthToken } from "@/lib/oauth/require-oauth-token";
import { generateAccessToken, hashOAuthSecret } from "@/lib/oauth/tokens";
import { ALL_OAUTH_SCOPES } from "@/lib/oauth/scopes";
import { generateApiKey, hashApiKey } from "@/lib/api-keys";
import { createMcpServer } from "@/lib/mcp/server";
import * as adminActions from "@/app/(dashboard)/admin/actions";
import * as settingsActions from "@/app/(dashboard)/settings/actions";
import * as mcpRoute from "@/app/api/mcp/route";
import * as extProjects from "@/app/api/external/v1/projects/route";
import * as extProject from "@/app/api/external/v1/projects/[key]/route";
import * as extIssues from "@/app/api/external/v1/projects/[key]/issues/route";
import * as extIssue from "@/app/api/external/v1/projects/[key]/issues/[issueKey]/route";
import * as extComments from "@/app/api/external/v1/projects/[key]/issues/[issueKey]/comments/route";
import * as v1Projects from "@/app/api/v1/projects/route";
import * as v1Issues from "@/app/api/v1/issues/route";

/**
 * SECH-85: negative tests for the three token-based auth systems — external org API keys,
 * the internal v1 shared secret, and OAuth bearer tokens (REST guard + MCP tools).
 */

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => {
  await prisma.rateLimitAttempt.deleteMany({ where: { key: { startsWith: `v1api:10.99.${w.tag.length}` } } });
  await destroyWorld(w);
});

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const ext = (method: string, path: string, key: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers: { ...(key ? { "X-Api-Key": key } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function snapshotA() {
  const [issues, comments, pages, project] = await Promise.all([
    prisma.issue.findMany({ where: { projectId: w.A.project.id }, orderBy: { key: "asc" }, select: { key: true, title: true, priority: true, parentId: true } }),
    prisma.comment.findMany({ where: { issue: { projectId: w.A.project.id } }, select: { id: true, body: true } }),
    prisma.docPage.findMany({ where: { docSpaceId: w.A.docSpace.id }, select: { id: true, title: true, content: true } }),
    prisma.project.findUniqueOrThrow({ where: { id: w.A.project.id }, select: { name: true, isClosed: true } }),
  ]);
  return { issues, comments, pages, project };
}

describe("external API (org-scoped X-Api-Key)", () => {
  it("control: an Org A key reads Org A's project and issue", async () => {
    expect((await extProject.GET(ext("GET", "/x", w.apiKeys.a), params({ key: w.keyA }))).status).toBe(200);
    const res = await extIssue.GET(ext("GET", "/x", w.apiKeys.a), params({ key: w.keyA, issueKey: w.A.issue.key }));
    expect(res.status).toBe(200);
  });

  it("an Org B key gets 404 on every Org A project, issue and comment route, and changes nothing", async () => {
    const before = await snapshotA();
    const k = w.apiKeys.b, pk = params({ key: w.keyA });
    const ik = params({ key: w.keyA, issueKey: w.A.issue.key });
    const attempts: Array<[string, () => Promise<Response>]> = [
      ["GET project", () => extProject.GET(ext("GET", "/x", k), pk)],
      ["GET issues", () => extIssues.GET(ext("GET", "/x", k), pk)],
      ["POST issue", () => extIssues.POST(ext("POST", "/x", k, { title: "pwn" }), pk)],
      ["GET issue", () => extIssue.GET(ext("GET", "/x", k), ik)],
      ["PATCH issue", () => extIssue.PATCH(ext("PATCH", "/x", k, { title: "pwn" }), ik)],
      ["GET comments", () => extComments.GET(ext("GET", "/x", k), ik)],
      ["POST comment", () => extComments.POST(ext("POST", "/x", k, { body: "pwn" }), ik)],
    ];
    for (const [name, attempt] of attempts) {
      expect((await attempt()).status, name).toBe(404);
    }
    expect(await snapshotA()).toEqual(before);
  });

  it("the project list only ever contains the key's own org", async () => {
    const res = await extProjects.GET(ext("GET", "/x", w.apiKeys.b));
    const { projects } = await res.json();
    const keys = projects.map((p: { key: string }) => p.key);
    expect(keys).toContain(w.keyB);
    expect(keys).not.toContain(w.keyA);
  });

  it("missing, unknown and revoked keys are 401", async () => {
    for (const key of [null, "jf_not-a-real-key", w.apiKeys.bRevoked]) {
      expect((await extProjects.GET(ext("GET", "/x", key))).status).toBe(401);
      expect((await extIssues.POST(ext("POST", "/x", key, { title: "x" }), params({ key: w.keyB }))).status).toBe(401);
    }
  });

  it("a revoked key stops working immediately", async () => {
    await prisma.apiKey.update({ where: { id: w.apiKeyA.id }, data: { revokedAt: new Date() } });
    try {
      expect((await extProject.GET(ext("GET", "/x", w.apiKeys.a), params({ key: w.keyA }))).status).toBe(401);
    } finally {
      await prisma.apiKey.update({ where: { id: w.apiKeyA.id }, data: { revokedAt: null } });
    }
  });

  it("closed projects are invisible to the key (404), even to their own org", async () => {
    await prisma.project.update({ where: { id: w.A.project.id }, data: { isClosed: true } });
    try {
      expect((await extProject.GET(ext("GET", "/x", w.apiKeys.a), params({ key: w.keyA }))).status).toBe(404);
      expect((await extIssues.POST(ext("POST", "/x", w.apiKeys.a, { title: "x" }), params({ key: w.keyA }))).status).toBe(404);
    } finally {
      await prisma.project.update({ where: { id: w.A.project.id }, data: { isClosed: false } });
    }
  });

  it("stays inside its own org even with hostile bodies", async () => {
    const pk = params({ key: w.keyB });
    // assignee from another org
    expect((await extIssues.POST(ext("POST", "/x", w.apiKeys.b, { title: "x", assigneeId: w.users.aOwner.id }), pk)).status).toBe(400);
    expect((await extIssue.PATCH(ext("PATCH", "/x", w.apiKeys.b, { assigneeId: w.users.aOwner.id }), params({ key: w.keyB, issueKey: w.B.issue.key }))).status).toBe(400);
    // extra fields are ignored; the comment author is always the key's creator
    const res = await extComments.POST(
      ext("POST", "/x", w.apiKeys.b, { body: "hello", authorId: w.users.aOwner.id }),
      params({ key: w.keyB, issueKey: w.B.issue.key })
    );
    expect(res.status).toBe(201);
    expect((await res.json()).authorId).toBe(w.users.bOwner.id);
    const patched = await extIssue.PATCH(
      ext("PATCH", "/x", w.apiKeys.b, { title: "ok", projectId: w.A.project.id }),
      params({ key: w.keyB, issueKey: w.B.issue2.key })
    );
    expect(patched.status).toBe(200);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: w.B.issue2.id } })).projectId).toBe(w.B.project.id);
  });
});

describe("internal v1 API (shared secret)", () => {
  // CI has no .env, and the guard (correctly) answers 500 when no secret is configured, so the
  // suite supplies its own instead of depending on the ambient environment.
  const originalSecret = process.env.V1_API_KEY;
  const secret = originalSecret ?? "itest-v1-secret";
  beforeAll(() => { process.env.V1_API_KEY = secret; });
  afterAll(() => {
    if (originalSecret === undefined) delete process.env.V1_API_KEY;
    else process.env.V1_API_KEY = originalSecret;
  });

  const ip = () => `10.99.${w.tag.length}.${Math.floor(Math.random() * 200) + 1}`;
  const v1 = (key: string | null) =>
    new NextRequest("http://localhost/api/v1/projects", {
      headers: { ...(key ? { "X-Internal-Api-Key": key } : {}), "x-forwarded-for": ip() },
    });

  it("rejects a missing or wrong secret", async () => {
    expect((await v1Projects.GET(v1(null))).status).toBe(401);
    expect((await v1Projects.GET(v1("definitely-wrong"))).status).toBe(401);
    expect((await v1Issues.GET(v1("definitely-wrong"))).status).toBe(401);
  });

  it("an Org API key or OAuth token is not accepted as the internal secret", async () => {
    expect((await v1Projects.GET(v1(w.apiKeys.a))).status).toBe(401);
    expect((await v1Projects.GET(v1(w.tokens.a))).status).toBe(401);
  });

  it("accepts the configured secret", async () => {
    expect((await v1Projects.GET(v1(secret))).status).toBe(200);
  });

  it("fails closed (500, never open) when no secret is configured", async () => {
    delete process.env.V1_API_KEY;
    try {
      expect((await v1Projects.GET(v1("anything"))).status).toBe(500);
      expect((await v1Projects.GET(v1(null))).status).toBe(500);
    } finally {
      process.env.V1_API_KEY = secret;
    }
  });
});

describe("OAuth bearer guard (REST)", () => {
  const post = (token: string | null) =>
    new NextRequest("http://localhost/api/mcp", {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

  it("rejects missing, malformed, unknown, expired and revoked tokens with a WWW-Authenticate challenge", async () => {
    for (const token of [null, "", "garbage", w.tokens.bExpired, w.tokens.bRevoked]) {
      const res = await mcpRoute.POST(post(token));
      expect(res.status, String(token)).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toMatch(/^Bearer resource_metadata=/);
    }
  });

  it("an API key is not a bearer token", async () => {
    expect((await mcpRoute.POST(post(w.apiKeys.a))).status).toBe(401);
  });

  it("a valid token resolves to exactly its own org and user", async () => {
    const ctx = await requireOAuthToken(new Request("http://x", { headers: { Authorization: `Bearer ${w.tokens.b}` } }));
    expect(ctx).toMatchObject({ orgId: w.orgB.id, userId: w.users.bMember.id });
  });
});

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };

async function mcp(token: string) {
  const ctx = await requireOAuthToken(new Request("http://x", { headers: { Authorization: `Bearer ${token}` } }));
  if (ctx instanceof Response) throw new Error("token rejected");
  const server = createMcpServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "itest", version: "1.0.0" });
  await client.connect(clientTransport);
  return {
    call: async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as ToolResult,
    close: () => client.close(),
  };
}
const text = (r: ToolResult) => r.content.map((c) => c.text ?? "").join("");

describe("MCP tools (OAuth bearer)", () => {
  it("control: an Org A token can use Org A's issue and docs", async () => {
    const t = await mcp(w.tokens.a);
    try {
      expect((await t.call("list_comments", { issueKey: w.A.issue.key })).isError).toBeFalsy();
      expect((await t.call("list_doc_pages", { projectKey: w.keyA })).isError).toBeFalsy();
    } finally { await t.close(); }
  });

  it("an Org B token cannot read, write or link Org A's issues, comments or docs", async () => {
    const before = await snapshotA();
    const t = await mcp(w.tokens.b);
    try {
      const attempts: Array<[string, string, Record<string, unknown>]> = [
        ["update_issue", "update_issue", { issueKey: w.A.issue.key, title: "pwn" }],
        ["add_comment", "add_comment", { issueKey: w.A.issue.key, body: "pwn" }],
        ["list_comments", "list_comments", { issueKey: w.A.issue.key }],
        ["create_issue", "create_issue", { projectKey: w.keyA, title: "pwn" }],
        ["set_issue_parent (parent in A)", "set_issue_parent", { issueKey: w.B.issue.key, parentIssueKey: w.A.issue.key }],
        ["set_issue_parent (child in A)", "set_issue_parent", { issueKey: w.A.issue.key, parentIssueKey: null }],
        ["link_issues (target in A)", "link_issues", { sourceIssueKey: w.B.issue.key, targetIssueKey: w.A.issue.key, linkType: "BLOCKS" }],
        ["link_issues (source in A)", "link_issues", { sourceIssueKey: w.A.issue.key, targetIssueKey: w.B.issue.key, linkType: "BLOCKS" }],
        ["list_doc_pages", "list_doc_pages", { projectKey: w.keyA }],
        ["read_doc_page", "read_doc_page", { projectKey: w.keyA, pageId: w.A.page.id }],
        ["write_doc_page (create)", "write_doc_page", { projectKey: w.keyA, title: "pwn", content: "<p>pwn</p>" }],
        ["write_doc_page (update)", "write_doc_page", { projectKey: w.keyA, pageId: w.A.page.id, content: "<p>pwn</p>" }],
      ];
      for (const [label, tool, args] of attempts) {
        const res = await t.call(tool, args);
        expect(res.isError, `${label}: ${text(res)}`).toBe(true);
      }
    } finally { await t.close(); }
    expect(await snapshotA()).toEqual(before);
  });

  it("unlink_issues cannot delete an Org A link by id", async () => {
    const link = await prisma.issueLink.create({
      data: { sourceIssueId: w.A.issue.id, targetIssueId: w.A.issue2.id, linkType: "RELATES_TO", createdById: w.users.aOwner.id },
    });
    const t = await mcp(w.tokens.b);
    try {
      expect((await t.call("unlink_issues", { linkId: link.id })).isError).toBe(true);
    } finally { await t.close(); }
    expect(await prisma.issueLink.count({ where: { id: link.id } })).toBe(1);
  });

  it("search only returns issues from projects in the token's org", async () => {
    const t = await mcp(w.tokens.b);
    try {
      const res = await t.call("search_issues", { query: 'status = "To Do"' });
      expect(res.isError).toBeFalsy();
      const { issues } = JSON.parse(text(res)) as { issues: Array<{ key: string }> };
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((i) => i.key.startsWith(w.keyB))).toBe(true);
      const direct = JSON.parse(text(await t.call("search_issues", { query: `project = "${w.keyA}"` }))) as { issues: unknown[] };
      expect(direct.issues).toEqual([]);
    } finally { await t.close(); }
  });

  it("scope limits are enforced per tool call", async () => {
    const t = await mcp(w.tokens.bReadOnly);
    try {
      for (const [tool, args] of [
        ["update_issue", { issueKey: w.B.issue.key, title: "x" }],
        ["add_comment", { issueKey: w.B.issue.key, body: "x" }],
        ["list_comments", { issueKey: w.B.issue.key }],
        ["list_doc_pages", { projectKey: w.keyB }],
        ["create_issue", { projectKey: w.keyB, title: "x" }],
      ] as Array<[string, Record<string, unknown>]>) {
        const res = await t.call(tool, args);
        expect(res.isError, tool).toBe(true);
        expect(text(res), tool).toMatch(/missing scope/i);
      }
      expect((await t.call("search_issues", { query: 'status = "To Do"' })).isError).toBeFalsy();
    } finally { await t.close(); }
  });

  it("closed projects are off-limits to write tools", async () => {
    await prisma.project.update({ where: { id: w.A.project.id }, data: { isClosed: true } });
    const t = await mcp(w.tokens.a);
    try {
      expect((await t.call("update_issue", { issueKey: w.A.issue.key, title: "closed" })).isError).toBe(true);
      expect((await t.call("create_issue", { projectKey: w.keyA, title: "closed" })).isError).toBe(true);
    } finally {
      await t.close();
      await prisma.project.update({ where: { id: w.A.project.id }, data: { isClosed: false } });
    }
  });
});

// SECH-94: sessionVersion only ever invalidated web sessions. OAuth tokens are opaque
// bearer strings (no captured session version to check live), so password reset, a
// platform role change, and org removal must actively revoke them instead — and org
// removal must also revoke API keys the leaving member created for that org. All
// fixtures here are ad-hoc (not w's shared users/tokens) since these tests permanently
// burn the credentials they touch; placed last in the file so nothing else depends on them.
describe("SECH-94: credentials are revoked when the owning user's password, role or org membership changes", () => {
  const oauthCtx = (token: string) =>
    requireOAuthToken(new Request("http://x", { headers: { Authorization: `Bearer ${token}` } }));

  async function makeToken(userId: string, orgId: string, clientId: string) {
    const plaintext = generateAccessToken();
    await prisma.oAuthAccessToken.create({
      data: {
        hashedToken: hashOAuthSecret(plaintext),
        clientId, userId, orgId,
        scope: ALL_OAUTH_SCOPES.join(" "),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    return plaintext;
  }

  it("adminResetUserPassword revokes the target's OAuth tokens", async () => {
    const target = await prisma.user.create({ data: { name: "reset target", email: `${w.tag}-resettarget@itest.local`, passwordHash: "x" } });
    const admin = await prisma.user.create({ data: { name: "root-reset", email: `${w.tag}-rootreset@itest.local`, passwordHash: "x", role: "ADMIN" } });
    const client = await prisma.oAuthClient.create({ data: { clientName: `itest-sech94a-${w.tag}`, redirectUris: ["http://localhost:9/cb"] } });
    try {
      const token = await makeToken(target.id, w.orgB.id, client.id);
      expect(await oauthCtx(token)).not.toBeInstanceOf(Response);

      actAs({ id: admin.id, name: admin.name, email: admin.email, role: "ADMIN", orgId: w.orgB.id });
      expect(await adminActions.adminResetUserPassword(target.id, "N3wPassw0rd!!")).toMatchObject({ success: true });

      const rejected = await oauthCtx(token);
      expect(rejected).toBeInstanceOf(Response);
      expect((rejected as Response).status).toBe(401);
    } finally {
      await prisma.oAuthAccessToken.deleteMany({ where: { clientId: client.id } });
      await prisma.oAuthClient.delete({ where: { id: client.id } });
      await prisma.user.deleteMany({ where: { id: { in: [target.id, admin.id] } } });
    }
  });

  it("adminUpdateUser revokes OAuth tokens only when the platform role actually changes", async () => {
    const target = await prisma.user.create({ data: { name: "role target", email: `${w.tag}-roletarget@itest.local`, passwordHash: "x" } });
    const admin = await prisma.user.create({ data: { name: "root-role", email: `${w.tag}-rootrole@itest.local`, passwordHash: "x", role: "ADMIN" } });
    const client = await prisma.oAuthClient.create({ data: { clientName: `itest-sech94b-${w.tag}`, redirectUris: ["http://localhost:9/cb"] } });
    try {
      const token = await makeToken(target.id, w.orgB.id, client.id);
      actAs({ id: admin.id, name: admin.name, email: admin.email, role: "ADMIN", orgId: w.orgB.id });

      // A name-only update must not touch the token.
      await adminActions.adminUpdateUser(target.id, { name: "Renamed Target" });
      expect(await oauthCtx(token)).not.toBeInstanceOf(Response);

      // A role change must revoke it.
      await adminActions.adminUpdateUser(target.id, { role: "ADMIN" });
      const rejected = await oauthCtx(token);
      expect(rejected).toBeInstanceOf(Response);
      expect((rejected as Response).status).toBe(401);
    } finally {
      await prisma.oAuthAccessToken.deleteMany({ where: { clientId: client.id } });
      await prisma.oAuthClient.delete({ where: { id: client.id } });
      await prisma.user.deleteMany({ where: { id: { in: [target.id, admin.id] } } });
    }
  });

  it("adminRemoveOrgMember revokes the leaving member's OAuth tokens and API keys for that org only", async () => {
    const member = await prisma.user.create({ data: { name: "org leaver", email: `${w.tag}-leaver@itest.local`, passwordHash: "x" } });
    const admin = await prisma.user.create({ data: { name: "root-remove", email: `${w.tag}-rootremove@itest.local`, passwordHash: "x", role: "ADMIN" } });
    await prisma.orgMember.create({ data: { orgId: w.orgB.id, userId: member.id, role: "MEMBER" } });
    const client = await prisma.oAuthClient.create({ data: { clientName: `itest-sech94c-${w.tag}`, redirectUris: ["http://localhost:9/cb"] } });
    const keyPlain = generateApiKey();
    const key = await prisma.apiKey.create({
      data: { orgId: w.orgB.id, name: "leaver key", keyPrefix: keyPlain.slice(0, 8), hashedKey: hashApiKey(keyPlain), createdById: member.id },
    });
    try {
      const tokenB = await makeToken(member.id, w.orgB.id, client.id); // org being left
      const tokenA = await makeToken(member.id, w.orgA.id, client.id); // unrelated org, must survive

      actAs({ id: admin.id, name: admin.name, email: admin.email, role: "ADMIN", orgId: w.orgB.id });
      expect(await adminActions.adminRemoveOrgMember(w.orgB.id, member.id)).toMatchObject({ success: true });

      const rejectedToken = await oauthCtx(tokenB);
      expect(rejectedToken).toBeInstanceOf(Response);
      expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt).not.toBeNull();

      // Membership in Org A was never touched — that token stays live.
      expect(await oauthCtx(tokenA)).not.toBeInstanceOf(Response);
    } finally {
      await prisma.oAuthAccessToken.deleteMany({ where: { clientId: client.id } });
      await prisma.oAuthClient.delete({ where: { id: client.id } });
      await prisma.apiKey.deleteMany({ where: { id: key.id } });
      await prisma.orgMember.deleteMany({ where: { userId: member.id } });
      await prisma.user.deleteMany({ where: { id: { in: [member.id, admin.id] } } });
    }
  });

  it("changePassword revokes the caller's own OAuth tokens", async () => {
    const currentPassword = "OldPassw0rd!!";
    const user = await prisma.user.create({
      data: { name: "pw changer", email: `${w.tag}-pwchanger@itest.local`, passwordHash: await bcrypt.hash(currentPassword, 12) },
    });
    const client = await prisma.oAuthClient.create({ data: { clientName: `itest-sech94d-${w.tag}`, redirectUris: ["http://localhost:9/cb"] } });
    try {
      const token = await makeToken(user.id, w.orgB.id, client.id);
      actAs({ id: user.id, name: user.name, email: user.email, role: "TEAM_MEMBER", orgId: w.orgB.id });

      const result = await settingsActions.changePassword(currentPassword, "NewPassw0rd!!");
      expect(result).toMatchObject({ success: true });

      expect(await oauthCtx(token)).toBeInstanceOf(Response);
    } finally {
      await prisma.oAuthAccessToken.deleteMany({ where: { clientId: client.id } });
      await prisma.oAuthClient.delete({ where: { id: client.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
