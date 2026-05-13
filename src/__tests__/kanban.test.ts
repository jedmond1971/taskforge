import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockPrisma, mockAuthFn, mockGenerateKey } = vi.hoisted(() => {
  const mockPrisma = {
    project: { findUnique: vi.fn() },
    projectMember: { findUnique: vi.fn() },
    issue: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  const mockAuthFn = vi.fn();
  const mockGenerateKey = vi.fn();
  return { mockPrisma, mockAuthFn, mockGenerateKey };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: mockAuthFn }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/issue-keys", () => ({ generateIssueKeyWithRetry: mockGenerateKey }));

import { createIssue, moveIssue, reorderIssues } from "@/app/(dashboard)/projects/[projectKey]/actions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockSession(userId = "user-1") {
  mockAuthFn.mockResolvedValue({ user: { id: userId, role: "TEAM_MEMBER" } });
}

function mockProjectMembership(projectId = "proj-1", orgId = "org-1", role = "PROJECT_LEAD") {
  mockPrisma.project.findUnique.mockResolvedValue({ id: projectId, key: "PRJ", orgId });
  mockPrisma.projectMember.findUnique.mockResolvedValue({ role });
}

function makeP2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed on key", {
    code: "P2002",
    clientVersion: "5.0.0",
    meta: { target: ["key"] },
  });
}

// ─── createIssue: issue key race condition ────────────────────────────────────

describe("createIssue — issue key retry on P2002", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockProjectMembership();
    mockPrisma.issue.count.mockResolvedValue(0);
    mockPrisma.activityLog.create.mockResolvedValue({});
    // $transaction used indirectly via activityLog; not needed here
  });

  it("succeeds on the first attempt when no collision", async () => {
    mockGenerateKey.mockResolvedValue("PRJ-1");
    const created = { id: "issue-1", key: "PRJ-1" };
    mockPrisma.issue.create.mockResolvedValueOnce(created);

    const result = await createIssue("PRJ", { title: "New issue" });

    expect(result.success).toBe(true);
    expect(result.issue.key).toBe("PRJ-1");
    expect(mockPrisma.issue.create).toHaveBeenCalledTimes(1);
  });

  it("retries on P2002 and succeeds on the second attempt", async () => {
    mockGenerateKey
      .mockResolvedValueOnce("PRJ-1") // first attempt — key collides
      .mockResolvedValueOnce("PRJ-2"); // second attempt — succeeds

    const created = { id: "issue-2", key: "PRJ-2" };
    mockPrisma.issue.create
      .mockRejectedValueOnce(makeP2002())
      .mockResolvedValueOnce(created);

    const result = await createIssue("PRJ", { title: "Race issue" });

    expect(result.success).toBe(true);
    expect(result.issue.key).toBe("PRJ-2");
    expect(mockPrisma.issue.create).toHaveBeenCalledTimes(2);
    expect(mockGenerateKey).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-P2002 errors immediately", async () => {
    mockGenerateKey.mockResolvedValue("PRJ-1");
    const dbError = new Error("connection refused");
    mockPrisma.issue.create.mockRejectedValueOnce(dbError);

    await expect(createIssue("PRJ", { title: "Broken issue" })).rejects.toThrow("connection refused");
    expect(mockPrisma.issue.create).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting all retries", async () => {
    mockGenerateKey.mockResolvedValue("PRJ-1");
    mockPrisma.issue.create.mockRejectedValue(makeP2002());

    await expect(createIssue("PRJ", { title: "Always collides" })).rejects.toThrow(
      /Could not create issue/
    );
    expect(mockPrisma.issue.create).toHaveBeenCalledTimes(5);
  });
});

// ─── moveIssue: cross-column source compaction ────────────────────────────────

describe("moveIssue — cross-column source column compaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockProjectMembership();
    mockPrisma.activityLog.create.mockResolvedValue({});
    mockPrisma.issue.update.mockResolvedValue({ id: "issue-1", status: "IN_PROGRESS", position: 0 });
    mockPrisma.issue.updateMany.mockResolvedValue({ count: 1 });
    // $transaction resolves each op in the array
    mockPrisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  });

  it("compacts the source column after a cross-column move", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({ id: "issue-1", status: "TODO", position: 1 });
    // Source column (TODO) has 2 remaining issues after the move
    mockPrisma.issue.findMany.mockResolvedValue([
      { id: "other-1" },
      { id: "other-2" },
    ]);

    await moveIssue("PRJ", "issue-1", "IN_PROGRESS", 0);

    // Should have fetched source column issues and normalized them
    expect(mockPrisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "TODO" }),
        orderBy: { position: "asc" },
      })
    );
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    const txCall = mockPrisma.$transaction.mock.calls[0][0] as unknown[];
    expect(txCall).toHaveLength(2); // 2 remaining issues get position 0 and 1
  });

  it("does not compact when the issue moves within the same column", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({ id: "issue-1", status: "TODO", position: 0 });

    await moveIssue("PRJ", "issue-1", "TODO", 2);

    // No compaction needed — status did not change
    expect(mockPrisma.issue.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("handles an empty source column gracefully after the last issue leaves", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({ id: "issue-1", status: "DONE", position: 0 });
    mockPrisma.issue.findMany.mockResolvedValue([]); // column is now empty

    await expect(moveIssue("PRJ", "issue-1", "IN_PROGRESS", 0)).resolves.toMatchObject({
      success: true,
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled(); // nothing to compact
  });
});

// ─── reorderIssues: within-column position reassignment ───────────────────────

describe("reorderIssues — within-column position normalisation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockProjectMembership();
    mockPrisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
    mockPrisma.issue.updateMany.mockResolvedValue({ count: 1 });
  });

  it("assigns sequential positions 0…N-1 to each issue", async () => {
    const ids = ["a", "b", "c"];
    await reorderIssues("PRJ", ids);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = mockPrisma.$transaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(3);
    // updateMany should have been called once per id (position 0, 1, 2)
    expect(mockPrisma.issue.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ id: "a" }), data: { position: 0 } })
    );
    expect(mockPrisma.issue.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ id: "b" }), data: { position: 1 } })
    );
    expect(mockPrisma.issue.updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ where: expect.objectContaining({ id: "c" }), data: { position: 2 } })
    );
  });

  it("handles a single-issue column without error", async () => {
    await expect(reorderIssues("PRJ", ["solo"])).resolves.toMatchObject({ success: true });
  });
});
