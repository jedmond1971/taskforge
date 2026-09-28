import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import * as v1Issues from "@/app/api/v1/issues/route";
import * as v1Issue from "@/app/api/v1/issues/[key]/route";

/**
 * JFR-140: the v1 API hardcoded every created issue to type TASK, with no way to create
 * a BUG/STORY/EPIC, and formatIssue() didn't even return `type` in any response.
 */

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => { await destroyWorld(w); });

const ip = () => `10.98.${w.tag.length}.${Math.floor(Math.random() * 200) + 1}`;
const secret = process.env.V1_API_KEY ?? "itest-v1-secret";
const originalSecret = process.env.V1_API_KEY;
beforeAll(() => { process.env.V1_API_KEY = secret; });
afterAll(() => {
  if (originalSecret === undefined) delete process.env.V1_API_KEY;
  else process.env.V1_API_KEY = originalSecret;
});

const params = (key: string) => ({ params: Promise.resolve({ key }) });
const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "X-Internal-Api-Key": secret, "content-type": "application/json", "x-forwarded-for": ip() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("v1 API issue type (JFR-140)", () => {
  it("defaults to TASK and returns type in the response when omitted", async () => {
    const res = await v1Issues.POST(
      req("POST", "/api/v1/issues", { projectId: w.A.project.id, title: `no-type-${w.tag}` })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.type).toBe("TASK");
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: body.id } })).type).toBe("TASK");
  });

  it.each(["BUG", "STORY", "EPIC", "TASK"])("creates a %s issue and returns its type", async (type) => {
    const res = await v1Issues.POST(
      req("POST", "/api/v1/issues", { projectId: w.A.project.id, title: `type-${type}-${w.tag}`, type })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.type).toBe(type);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: body.id } })).type).toBe(type);
  });

  it("rejects an invalid type and creates nothing", async () => {
    const before = await prisma.issue.count({ where: { projectId: w.A.project.id } });
    const res = await v1Issues.POST(
      req("POST", "/api/v1/issues", { projectId: w.A.project.id, title: `bad-type-${w.tag}`, type: "FEATURE" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid type/);
    expect(await prisma.issue.count({ where: { projectId: w.A.project.id } })).toBe(before);
  });

  it("GET returns type for an existing issue", async () => {
    const res = await v1Issue.GET(req("GET", `/api/v1/issues/${w.A.issue.key}`), params(w.A.issue.key));
    expect(res.status).toBe(200);
    expect((await res.json()).type).toBe("TASK");
  });

  it("PATCH updates an issue's type and returns the new value", async () => {
    const res = await v1Issue.PATCH(
      req("PATCH", `/api/v1/issues/${w.A.issue2.key}`, { type: "BUG" }),
      params(w.A.issue2.key)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).type).toBe("BUG");
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: w.A.issue2.id } })).type).toBe("BUG");

    // restore for isolation from other tests reading w.A.issue2
    await prisma.issue.update({ where: { id: w.A.issue2.id }, data: { type: "TASK" } });
  });

  it("PATCH rejects an invalid type and changes nothing", async () => {
    const before = await prisma.issue.findUniqueOrThrow({ where: { id: w.A.issue2.id } });
    const res = await v1Issue.PATCH(
      req("PATCH", `/api/v1/issues/${w.A.issue2.key}`, { type: "NOT_A_TYPE" }),
      params(w.A.issue2.key)
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid type/);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: w.A.issue2.id } })).type).toBe(before.type);
  });
});
