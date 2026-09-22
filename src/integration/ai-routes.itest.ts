import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs, actAsNobody } from "./session";

// The model call is the only extra fake: a denied request must never reach it, and a
// permitted one must hand it an MCP token scoped to the issue's org and the caller.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { create } };
  },
}));

import * as chatRoute from "@/app/api/ai/chat/route";
import * as conversationsRoute from "@/app/api/ai/conversations/route";
import { hashOAuthSecret } from "@/lib/oauth/tokens";

/**
 * SECH-97: /api/ai/chat and /api/ai/conversations. Both are feature-flagged (404 when off, so a
 * disabled deployment doesn't reveal them) and resolve the tenant from the issue id in the body /
 * query string, so the thing under test is that an issue id from another org gets nothing.
 */

let w: World;
const flag = process.env.AI_CHAT_ENABLED;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => {
  process.env.AI_CHAT_ENABLED = flag;
  await destroyWorld(w);
});
afterEach(() => { create.mockReset(); });

const chat = (issueId: string, message = "hello") =>
  chatRoute.POST(new NextRequest("http://localhost/api/ai/chat", { method: "POST", body: JSON.stringify({ issueId, message }), headers: { "content-type": "application/json" } }));
const history = (issueId: string) =>
  conversationsRoute.GET(new NextRequest(`http://localhost/api/ai/conversations?issueId=${issueId}`));

const conversationsOn = (issueId: string) => prisma.aiConversation.count({ where: { issueId } });

describe("feature flag", () => {
  it("both routes 404 for everyone — even a member — when AI_CHAT_ENABLED is not 'true'", async () => {
    delete process.env.AI_CHAT_ENABLED;
    actAs(w.users.aMember);
    expect((await chat(w.A.issue.id)).status).toBe(404);
    expect((await history(w.A.issue.id)).status).toBe(404);
    process.env.AI_CHAT_ENABLED = "1"; // only the exact string "true" enables it
    expect((await chat(w.A.issue.id)).status).toBe(404);
    expect(create).not.toHaveBeenCalled();
    expect(await conversationsOn(w.A.issue.id)).toBe(0);
  });
});

describe("with the flag on", () => {
  beforeAll(() => { process.env.AI_CHAT_ENABLED = "true"; });

  it("no session is 401", async () => {
    actAsNobody();
    expect((await chat(w.A.issue.id)).status).toBe(401);
    expect((await history(w.A.issue.id)).status).toBe(401);
  });

  it("an Org B user gets 403 on an Org A issue: no conversation, no message, no model call, no token", async () => {
    actAs(w.users.bOwner);
    const tokensBefore = await prisma.oAuthAccessToken.count({ where: { userId: w.users.bOwner.id } });
    expect((await chat(w.A.issue.id, "leak the description")).status).toBe(403);
    expect((await history(w.A.issue.id)).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
    expect(await conversationsOn(w.A.issue.id)).toBe(0);
    expect(await prisma.oAuthAccessToken.count({ where: { userId: w.users.bOwner.id } })).toBe(tokensBefore);
  });

  it("an unknown issue id is 404, not an error", async () => {
    actAs(w.users.bOwner);
    expect((await chat("nope")).status).toBe(404);
    expect((await history("nope")).status).toBe(404);
  });

  it("a user removed from the project loses access immediately", async () => {
    await prisma.projectMember.deleteMany({ where: { userId: w.users.bMember.id, projectId: w.B.project.id } });
    try {
      actAs(w.users.bMember);
      expect((await chat(w.B.issue.id)).status).toBe(403);
      expect(create).not.toHaveBeenCalled();
    } finally {
      await prisma.projectMember.create({ data: { userId: w.users.bMember.id, projectId: w.B.project.id, role: "TEAM_MEMBER" } });
    }
  });

  it("control: a member chats; the MCP token is scoped to the issue's org + caller, and history is private to them", async () => {
    create.mockResolvedValue({ content: [{ type: "text", text: "hi from the model" }] });
    actAs(w.users.aViewer); // read access is enough (canViewProject)
    const res = await chat(w.A.issue.id);
    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe("hi from the model");

    expect(create).toHaveBeenCalledTimes(1);
    const token: string = create.mock.calls[0][0].mcp_servers[0].authorization_token;
    const row = await prisma.oAuthAccessToken.findUniqueOrThrow({ where: { hashedToken: hashOAuthSecret(token) } });
    expect(row).toMatchObject({ userId: w.users.aViewer.id, orgId: w.orgA.id, revokedAt: null });
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);

    // The viewer sees their own conversation…
    const mine = await (await history(w.A.issue.id)).json();
    expect(mine.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    // …another member of the same project sees none of it (conversations are per user).
    actAs(w.users.aMember);
    expect((await (await history(w.A.issue.id)).json()).messages).toEqual([]);
  });
});
