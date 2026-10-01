import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs } from "./session";
import { requireOAuthToken } from "@/lib/oauth/require-oauth-token";
import { createMcpServer } from "@/lib/mcp/server";
import * as issueActions from "@/app/(dashboard)/projects/[projectKey]/actions";

/** JFR-165 (MCP parent/child) and JFR-166 (bulk-edit parent). */

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => { await destroyWorld(w); });

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };
const text = (r: ToolResult) => r.content.map((c) => c.text ?? "").join("");
const json = (r: ToolResult) => JSON.parse(text(r));

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

const parentKeyOf = async (key: string) =>
  (await prisma.issue.findUniqueOrThrow({ where: { key }, select: { parent: { select: { key: true } } } })).parent?.key ?? null;

describe("MCP parent/child hierarchy (JFR-165)", () => {
  it("builds Epic → Story → Task with create_issue and reads it back", async () => {
    const t = await mcp(w.tokens.a);
    try {
      const epic = json(await t.call("create_issue", { projectKey: w.keyA, title: "Epic", type: "EPIC" }));
      expect(epic).toMatchObject({ parentKey: null, childCount: 0, childKeys: [] });

      const story = json(await t.call("create_issue", { projectKey: w.keyA, title: "Story", type: "STORY", parentIssueKey: epic.key }));
      expect(story.parentKey).toBe(epic.key);

      const task = json(await t.call("create_issue", { projectKey: w.keyA, title: "Task", parentIssueKey: story.key }));
      expect(task.parentKey).toBe(story.key);
      expect(await parentKeyOf(task.key)).toBe(story.key);

      const found = json(await t.call("search_issues", { query: `project = "${w.keyA}"` }));
      const byKey = Object.fromEntries(found.issues.map((i: { key: string }) => [i.key, i]));
      expect(byKey[epic.key]).toMatchObject({ parentKey: null, childCount: 1, childKeys: [story.key] });
      expect(byKey[story.key]).toMatchObject({ parentKey: epic.key, childCount: 1, childKeys: [task.key] });
      expect(byKey[task.key]).toMatchObject({ parentKey: story.key, childCount: 0 });
    } finally { await t.close(); }
  });

  it("update_issue assigns, moves and removes a parent, and logs it", async () => {
    const t = await mcp(w.tokens.a);
    try {
      const a = w.A.issue.key, b = w.A.issue2.key;
      const child = json(await t.call("create_issue", { projectKey: w.keyA, title: "Mover" }));

      expect(json(await t.call("update_issue", { issueKey: child.key, parentIssueKey: a })).parentKey).toBe(a);
      expect(json(await t.call("update_issue", { issueKey: child.key, parentIssueKey: b })).parentKey).toBe(b);
      expect(json(await t.call("update_issue", { issueKey: child.key, parentIssueKey: null })).parentKey).toBeNull();
      expect(await parentKeyOf(child.key)).toBeNull();

      const logs = await prisma.activityLog.findMany({ where: { issue: { key: child.key }, field: "parent" }, orderBy: { createdAt: "asc" } });
      expect(logs.map((l) => [l.oldValue, l.newValue])).toEqual([["", a], [a, b], [b, ""]]);
    } finally { await t.close(); }
  });

  it("rejects cycles, self-parenting and unknown or cross-org parents", async () => {
    const t = await mcp(w.tokens.a);
    try {
      const top = json(await t.call("create_issue", { projectKey: w.keyA, title: "Top" }));
      const mid = json(await t.call("create_issue", { projectKey: w.keyA, title: "Mid", parentIssueKey: top.key }));

      for (const res of [
        await t.call("set_issue_parent", { issueKey: top.key, parentIssueKey: mid.key }),
        await t.call("update_issue", { issueKey: top.key, parentIssueKey: mid.key }),
      ]) {
        expect(res.isError).toBe(true);
        expect(text(res)).toMatch(/circular/i);
      }
      expect(text(await t.call("set_issue_parent", { issueKey: top.key, parentIssueKey: top.key }))).toMatch(/own parent/i);
      expect((await t.call("create_issue", { projectKey: w.keyA, title: "x", parentIssueKey: "NOPE-1" })).isError).toBe(true);
      expect((await t.call("create_issue", { projectKey: w.keyA, title: "x", parentIssueKey: w.B.issue.key })).isError).toBe(true);
      expect((await t.call("update_issue", { issueKey: top.key, parentIssueKey: w.B.issue.key })).isError).toBe(true);
      expect(await parentKeyOf(top.key)).toBeNull();
    } finally { await t.close(); }
  });

  it("a failed create_issue with a bad parent leaves no orphan issue behind", async () => {
    const t = await mcp(w.tokens.a);
    try {
      const before = await prisma.issue.count({ where: { projectId: w.A.project.id } });
      await t.call("create_issue", { projectKey: w.keyA, title: "ghost", parentIssueKey: "NOPE-1" });
      expect(await prisma.issue.count({ where: { projectId: w.A.project.id } })).toBe(before);
    } finally { await t.close(); }
  });
});

describe("bulkUpdateIssueFields parent (JFR-166)", () => {
  const make = (key: string, parentId: string | null = null) =>
    prisma.issue.create({
      data: { key, projectId: w.A.project.id, title: key, statusId: w.A.statuses.todo.id, reporterId: w.users.aOwner.id, position: 100 + Math.floor(Math.random() * 1e6), parentId },
    });

  it("sets one parent on many issues, then clears it, with activity entries", async () => {
    actAs(w.users.aMember);
    const parent = await make(`${w.keyA}-901`);
    const c1 = await make(`${w.keyA}-902`);
    const c2 = await make(`${w.keyA}-903`, w.A.issue.id);

    expect(await issueActions.bulkUpdateIssueFields(w.keyA, [c1.id, c2.id], { parentId: parent.id })).toMatchObject({ count: 2 });
    expect(await parentKeyOf(c1.key)).toBe(parent.key);
    expect(await parentKeyOf(c2.key)).toBe(parent.key);

    const log = await prisma.activityLog.findFirstOrThrow({ where: { issueId: c2.id, field: "parent" } });
    expect([log.oldValue, log.newValue]).toEqual([w.A.issue.key, parent.key]);

    // Re-applying the same parent is a no-op, not a change.
    expect(await issueActions.bulkUpdateIssueFields(w.keyA, [c1.id, c2.id], { parentId: parent.id })).toMatchObject({ count: 0 });

    expect(await issueActions.bulkUpdateIssueFields(w.keyA, [c1.id, c2.id], { parentId: null })).toMatchObject({ count: 2 });
    expect(await parentKeyOf(c1.key)).toBeNull();
    expect(await parentKeyOf(c2.key)).toBeNull();
  });

  it("rejects a parent that is selected, a descendant of a selected issue, or outside the project", async () => {
    actAs(w.users.aMember);
    const top = await make(`${w.keyA}-911`);
    const mid = await make(`${w.keyA}-912`, top.id);

    await expect(issueActions.bulkUpdateIssueFields(w.keyA, [top.id, mid.id], { parentId: top.id })).rejects.toThrow(/circular/i);
    await expect(issueActions.bulkUpdateIssueFields(w.keyA, [top.id], { parentId: mid.id })).rejects.toThrow(/circular/i);
    await expect(issueActions.bulkUpdateIssueFields(w.keyA, [top.id], { parentId: w.B.issue.id })).rejects.toThrow(/not found in this project/i);
    expect(await parentKeyOf(top.key)).toBeNull();
  });

  it("a viewer cannot re-parent", async () => {
    actAs(w.users.aViewer);
    await expect(issueActions.bulkUpdateIssueFields(w.keyA, [w.A.issue.id], { parentId: w.A.issue2.id })).rejects.toThrow(/forbidden|unauthorized|not a project member/i);
  });
});
