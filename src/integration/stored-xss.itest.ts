import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs } from "./session";
import { XSS_PAYLOADS, activeContentIn } from "@/test-support/xss-payloads";

import { requireOAuthToken } from "@/lib/oauth/require-oauth-token";
import { createMcpServer } from "@/lib/mcp/server";
import * as issueActions from "@/app/(dashboard)/projects/[projectKey]/actions";
import * as v1Issues from "@/app/api/v1/issues/route";
import * as v1Issue from "@/app/api/v1/issues/[key]/route";
import * as v1Comments from "@/app/api/v1/issues/[key]/comments/route";
import * as v1Comment from "@/app/api/v1/issues/[key]/comments/[commentId]/route";
import * as extIssues from "@/app/api/external/v1/projects/[key]/issues/route";
import * as extIssue from "@/app/api/external/v1/projects/[key]/issues/[issueKey]/route";
import * as extComments from "@/app/api/external/v1/projects/[key]/issues/[issueKey]/comments/route";
import * as docsPages from "@/app/api/docs/[projectKey]/pages/route";
import * as docsPage from "@/app/api/docs/[projectKey]/pages/[pageId]/route";
import * as docsSearch from "@/app/api/docs/[projectKey]/search/route";
import * as issueRoute from "@/app/api/issues/[issueId]/route";

/**
 * SECH-106: stored XSS cannot survive any persistence path.
 *
 * The hermetic half (xss-corpus.test.ts) proves the sanitisers neutralise every
 * payload. This half proves each write path actually *calls* one — the failure this
 * ticket exists for is a path that quietly skips it, which no unit test can see.
 *
 * Every path is fed the whole corpus concatenated into one document, so a single
 * write exercises all 30 vectors. Granularity per payload lives in the unit test;
 * what matters here is the wiring.
 */

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => { await destroyWorld(w); });

/** Every payload in one document, so one write per path covers the whole corpus. */
const CORPUS = XSS_PAYLOADS.map((p) => p.payload).join("\n");

/** Assert a value read back out of Postgres is inert. */
function expectStoredClean(stored: string | null | undefined, where: string) {
  expect(stored, `${where}: nothing was stored, so this path was not exercised`).toBeTruthy();
  expect(activeContentIn(stored ?? ""), `${where} stored active content:\n${stored}`).toEqual([]);
}

// Rate limits are keyed per IP; vary it so a long run cannot trip them.
let ipCounter = 0;
const ip = () => `10.77.${(ipCounter++ % 250) + 1}.${(ipCounter % 250) + 1}`;

const V1_SECRET = "itest-v1-secret-for-stored-xss";
let originalV1: string | undefined;
beforeAll(() => { originalV1 = process.env.V1_API_KEY; process.env.V1_API_KEY = V1_SECRET; });
afterAll(() => {
  if (originalV1 === undefined) delete process.env.V1_API_KEY;
  else process.env.V1_API_KEY = originalV1;
});

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const v1Req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "X-Internal-Api-Key": V1_SECRET, "content-type": "application/json", "x-forwarded-for": ip() },
  });

const extReq = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "X-Api-Key": w.apiKeys.a, "content-type": "application/json", "x-forwarded-for": ip() },
  });

const sessionReq = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip() },
  });

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };
async function mcp(token: string) {
  const ctx = await requireOAuthToken(new Request("http://x", { headers: { Authorization: `Bearer ${token}` } }));
  if (ctx instanceof Response) throw new Error("token rejected");
  const server = createMcpServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "itest-xss", version: "1.0.0" });
  await client.connect(clientTransport);
  return {
    call: async (name: string, args: Record<string, unknown>) =>
      (await client.callTool({ name, arguments: args })) as ToolResult,
    close: () => client.close(),
  };
}

describe("session server actions", () => {
  beforeAll(() => actAs(w.users.aOwner));

  it("createIssue stores a sanitised description", async () => {
    actAs(w.users.aOwner);
    const created = (await issueActions.createIssue(w.keyA, {
      title: "xss create",
      description: CORPUS,
    })) as { issue: { id: string } };
    const row = await prisma.issue.findUnique({ where: { id: created.issue.id } });
    expectStoredClean(row?.description, "createIssue");
  });

  it("updateIssue stores a sanitised description", async () => {
    actAs(w.users.aOwner);
    await issueActions.updateIssue(w.keyA, w.A.issue2.id, { description: CORPUS });
    const row = await prisma.issue.findUnique({ where: { id: w.A.issue2.id } });
    expectStoredClean(row?.description, "updateIssue");
  });

  it("addComment stores a sanitised body", async () => {
    actAs(w.users.aOwner);
    await issueActions.addComment(w.keyA, w.A.issue.id, CORPUS);
    const row = await prisma.comment.findFirst({
      where: { issueId: w.A.issue.id }, orderBy: { createdAt: "desc" },
    });
    expectStoredClean(row?.body, "addComment");
  });

  it("updateComment stores a sanitised body", async () => {
    actAs(w.users.aOwner);
    await issueActions.updateComment(w.keyA, w.A.comment.id, CORPUS);
    const row = await prisma.comment.findUnique({ where: { id: w.A.comment.id } });
    expectStoredClean(row?.body, "updateComment");
  });
});

describe("internal v1 API", () => {
  it("POST /api/v1/issues stores a sanitised description", async () => {
    const res = await v1Issues.POST(
      v1Req("POST", "/api/v1/issues", {
        projectId: w.A.project.id, title: "v1 xss", description: CORPUS, reporterId: w.users.aOwner.id,
      }),
    );
    expect(res.status).toBeLessThan(300);
    const issue = (await res.json()) as { id: string };
    const row = await prisma.issue.findUnique({ where: { id: issue.id } });
    expectStoredClean(row?.description, "v1 POST /issues");
  });

  it("PATCH /api/v1/issues/[key] stores a sanitised description", async () => {
    const res = await v1Issue.PATCH(
      v1Req("PATCH", `/api/v1/issues/${w.A.issue2.key}`, { description: CORPUS }),
      params({ key: w.A.issue2.key }),
    );
    expect(res.status).toBeLessThan(300);
    const row = await prisma.issue.findUnique({ where: { id: w.A.issue2.id } });
    expectStoredClean(row?.description, "v1 PATCH /issues/[key]");
  });

  it("POST /api/v1/issues/[key]/comments stores a sanitised body", async () => {
    const res = await v1Comments.POST(
      v1Req("POST", `/api/v1/issues/${w.A.issue.key}/comments`, { authorId: w.users.aOwner.id, body: CORPUS }),
      params({ key: w.A.issue.key }),
    );
    expect(res.status).toBeLessThan(300);
    const comment = (await res.json()) as { id: string };
    const row = await prisma.comment.findUnique({ where: { id: comment.id } });
    expectStoredClean(row?.body, "v1 POST comments");
  });

  it("PATCH /api/v1/issues/[key]/comments/[commentId] stores a sanitised body", async () => {
    const res = await v1Comment.PATCH(
      v1Req("PATCH", `/api/v1/issues/${w.A.issue.key}/comments/${w.A.comment.id}`, { body: CORPUS }),
      params({ key: w.A.issue.key, commentId: w.A.comment.id }),
    );
    expect(res.status).toBeLessThan(300);
    const row = await prisma.comment.findUnique({ where: { id: w.A.comment.id } });
    expectStoredClean(row?.body, "v1 PATCH comment");
  });
});

describe("external org-API-key API", () => {
  it("POST issues stores a sanitised description", async () => {
    const res = await extIssues.POST(
      extReq("POST", `/api/external/v1/projects/${w.keyA}/issues`, { title: "ext xss", description: CORPUS }),
      params({ key: w.keyA }),
    );
    expect(res.status).toBeLessThan(300);
    const body = (await res.json()) as { issue?: { key: string }; key?: string };
    const key = body.issue?.key ?? body.key!;
    const row = await prisma.issue.findFirst({ where: { key, projectId: w.A.project.id } });
    expectStoredClean(row?.description, "external POST issues");
  });

  it("PATCH issue stores a sanitised description", async () => {
    const res = await extIssue.PATCH(
      extReq("PATCH", `/api/external/v1/projects/${w.keyA}/issues/${w.A.issue2.key}`, { description: CORPUS }),
      params({ key: w.keyA, issueKey: w.A.issue2.key }),
    );
    expect(res.status).toBeLessThan(300);
    const row = await prisma.issue.findUnique({ where: { id: w.A.issue2.id } });
    expectStoredClean(row?.description, "external PATCH issue");
  });

  it("POST comment stores a sanitised body", async () => {
    const res = await extComments.POST(
      extReq("POST", `/api/external/v1/projects/${w.keyA}/issues/${w.A.issue.key}/comments`, { body: CORPUS }),
      params({ key: w.keyA, issueKey: w.A.issue.key }),
    );
    expect(res.status).toBeLessThan(300);
    const row = await prisma.comment.findFirst({
      where: { issueId: w.A.issue.id }, orderBy: { createdAt: "desc" },
    });
    expectStoredClean(row?.body, "external POST comment");
  });

  it("plain-text input is escaped rather than stored as live markup", async () => {
    // normalizeBody() HTML-escapes anything that does not start with '<'.
    const res = await extComments.POST(
      extReq("POST", `/api/external/v1/projects/${w.keyA}/issues/${w.A.issue.key}/comments`, {
        body: 'plain text <script>alert(1)</script> tail',
      }),
      params({ key: w.keyA, issueKey: w.A.issue.key }),
    );
    expect(res.status).toBeLessThan(300);
    const row = await prisma.comment.findFirst({
      where: { issueId: w.A.issue.id }, orderBy: { createdAt: "desc" },
    });
    expectStoredClean(row?.body, "external POST comment (plain text)");
    expect(row?.body).toContain("&lt;script&gt;");
  });
});

describe("session API routes", () => {
  it("PATCH /api/issues/[issueId] stores a sanitised description", async () => {
    actAs(w.users.aOwner);
    const res = await issueRoute.PATCH(
      sessionReq("PATCH", `/api/issues/${w.A.issue2.id}`, { description: CORPUS }),
      params({ issueId: w.A.issue2.id }),
    );
    expect(res.status).toBeLessThan(300);
    const row = await prisma.issue.findUnique({ where: { id: w.A.issue2.id } });
    expectStoredClean(row?.description, "PATCH /api/issues/[issueId]");
  });
});

describe("docs pages", () => {
  let createdPageId: string;

  it("POST /api/docs/[projectKey]/pages stores sanitised content", async () => {
    actAs(w.users.aOwner);
    const res = await docsPages.POST(
      sessionReq("POST", `/api/docs/${w.keyA}/pages`, { title: "xss page", content: CORPUS }),
      params({ projectKey: w.keyA }),
    );
    expect(res.status).toBeLessThan(300);
    const { page } = (await res.json()) as { page: { id: string } };
    createdPageId = page.id;
    const row = await prisma.docPage.findUnique({ where: { id: page.id } });
    expectStoredClean(row?.content, "docs POST page");
  });

  it("PATCH /api/docs/[projectKey]/pages/[pageId] stores sanitised content", async () => {
    actAs(w.users.aOwner);
    const res = await docsPage.PATCH(
      sessionReq("PATCH", `/api/docs/${w.keyA}/pages/${createdPageId}`, { content: CORPUS }),
      params({ projectKey: w.keyA, pageId: createdPageId }),
    );
    expect(res.status).toBeLessThan(300);
    const row = await prisma.docPage.findUnique({ where: { id: createdPageId } });
    expectStoredClean(row?.content, "docs PATCH page");
  });

  it("the revision snapshot is clean too", async () => {
    // Revisions are copies of already-sanitised content; this is the assertion that
    // justifies the pageRevision exception in rich-text-sinks.test.ts.
    const revisions = await prisma.pageRevision.findMany({ where: { pageId: createdPageId } });
    expect(revisions.length).toBeGreaterThan(0);
    for (const r of revisions) expectStoredClean(r.content, "pageRevision snapshot");
  });

  it("the search snippet for a poisoned page carries no markup", async () => {
    actAs(w.users.aOwner);
    const res = await docsSearch.GET(
      sessionReq("GET", `/api/docs/${w.keyA}/search?q=alert`),
      params({ projectKey: w.keyA }),
    );
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: Array<{ snippet: string | null }> };
    for (const r of results) {
      if (!r.snippet) continue;
      expect(activeContentIn(r.snippet), `search snippet carried markup:\n${r.snippet}`).toEqual([]);
      expect(r.snippet, "snippets are plain text, tags stripped").not.toMatch(/<[a-z]/i);
    }
  });
});

describe("MCP tools", () => {
  it("create_issue, update_issue, add_comment and write_doc_page all store sanitised content", async () => {
    const t = await mcp(w.tokens.a);
    try {
      const created = await t.call("create_issue", { projectKey: w.keyA, title: "mcp xss", description: CORPUS });
      expect(created.isError).toBeFalsy();
      const newest = await prisma.issue.findFirst({
        where: { projectId: w.A.project.id, title: "mcp xss" }, orderBy: { createdAt: "desc" },
      });
      expectStoredClean(newest?.description, "MCP create_issue");

      expect((await t.call("update_issue", { issueKey: w.A.issue2.key, description: CORPUS })).isError).toBeFalsy();
      const updated = await prisma.issue.findUnique({ where: { id: w.A.issue2.id } });
      expectStoredClean(updated?.description, "MCP update_issue");

      expect((await t.call("add_comment", { issueKey: w.A.issue.key, body: CORPUS })).isError).toBeFalsy();
      const comment = await prisma.comment.findFirst({
        where: { issueId: w.A.issue.id }, orderBy: { createdAt: "desc" },
      });
      expectStoredClean(comment?.body, "MCP add_comment");

      expect((await t.call("write_doc_page", { projectKey: w.keyA, title: "mcp xss page", content: CORPUS })).isError).toBeFalsy();
      const page = await prisma.docPage.findFirst({
        where: { docSpaceId: w.A.docSpace.id, title: "mcp xss page" }, orderBy: { createdAt: "desc" },
      });
      expectStoredClean(page?.content, "MCP write_doc_page");
    } finally {
      await t.close();
    }
  });
});
