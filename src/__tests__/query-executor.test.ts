import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    user: { findFirst: vi.fn() },
    issue: { findMany: vi.fn(), count: vi.fn() },
  };
  return { mockPrisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { executeQuery } from "@/lib/query/executor";
import type { QueryContext } from "@/lib/query/executor";
import { parse } from "@/lib/query/parser";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const emptyResult = { issues: [], total: 0 };

function noIssues() {
  mockPrisma.issue.findMany.mockResolvedValue([]);
  mockPrisma.issue.count.mockResolvedValue(0);
}

function ctx(memberProjectIds: string[], userId = "user-1"): QueryContext {
  return { userId, memberProjectIds };
}

// ─── Security: memberProjectIds always scopes results ────────────────────────

describe("executeQuery — visibility scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noIssues();
  });

  it("always includes a projectId-in filter even with no WHERE clause", async () => {
    await executeQuery(parse(""), ctx(["proj-a", "proj-b"]));

    const whereArg = mockPrisma.issue.findMany.mock.calls[0][0].where;
    // Top-level where must constrain projectId to member projects
    const securityClause = extractProjectIdFilter(whereArg);
    expect(securityClause).toEqual({ in: ["proj-a", "proj-b"] });
  });

  it("ANDs the security filter with the user's WHERE clause", async () => {
    await executeQuery(parse('status = "TODO"'), ctx(["proj-x"]));

    const whereArg = mockPrisma.issue.findMany.mock.calls[0][0].where;
    // Should be an AND of [security, userClause]
    expect(whereArg).toHaveProperty("AND");
    const andClauses: unknown[] = whereArg.AND;
    const securityPart = andClauses.find(
      (c) => typeof c === "object" && c !== null && "projectId" in (c as object)
    ) as Record<string, unknown> | undefined;
    expect(securityPart?.projectId).toEqual({ in: ["proj-x"] });
  });

  it("returns no issues when memberProjectIds is empty", async () => {
    const result = await executeQuery(parse(""), ctx([]));
    expect(result.total).toBe(0);
    const whereArg = mockPrisma.issue.findMany.mock.calls[0][0].where;
    const securityClause = extractProjectIdFilter(whereArg);
    expect(securityClause).toEqual({ in: [] });
  });

  it("resolves currentUser to the context userId in assignee queries", async () => {
    await executeQuery(parse("assignee = currentUser()"), ctx(["proj-1"], "me-123"));

    const whereArg = mockPrisma.issue.findMany.mock.calls[0][0].where;
    // Find the assigneeId clause deep in the AND
    const andClauses: unknown[] = whereArg.AND ?? [];
    const assigneePart = andClauses.find(
      (c) => typeof c === "object" && c !== null && "assigneeId" in (c as object)
    ) as Record<string, unknown> | undefined;
    expect(assigneePart?.assigneeId).toBe("me-123");
  });

  it("does not call prisma.user.findFirst for currentUser (uses context directly)", async () => {
    await executeQuery(parse("assignee = currentUser()"), ctx(["proj-1"], "me-123"));
    expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("applies ORDER BY createdAt desc by default", async () => {
    await executeQuery(parse(""), ctx(["p1"]));
    const orderByArg = mockPrisma.issue.findMany.mock.calls[0][0].orderBy;
    expect(orderByArg).toEqual([{ createdAt: "desc" }]);
  });

  it("honours an explicit ORDER BY from the query", async () => {
    await executeQuery(parse("ORDER BY priority ASC"), ctx(["p1"]));
    const orderByArg = mockPrisma.issue.findMany.mock.calls[0][0].orderBy;
    expect(orderByArg).toEqual([{ priority: "asc" }]);
  });

  it("respects the limit parameter", async () => {
    await executeQuery(parse(""), ctx(["p1"]), 25);
    const takeArg = mockPrisma.issue.findMany.mock.calls[0][0].take;
    expect(takeArg).toBe(25);
  });
});

// ─── Helper: extract the projectId security clause from a where argument ──────

function extractProjectIdFilter(where: unknown): unknown {
  if (!where || typeof where !== "object") return undefined;
  const w = where as Record<string, unknown>;

  if ("projectId" in w) return w.projectId;

  // Unwrap AND arrays
  if (Array.isArray(w.AND)) {
    for (const clause of w.AND as unknown[]) {
      const found = extractProjectIdFilter(clause);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
