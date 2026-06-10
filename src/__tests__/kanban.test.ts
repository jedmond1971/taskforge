import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockPrisma, mockAuthFn } = vi.hoisted(() => {
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
      findUniqueOrThrow: vi.fn(),
    },
    activityLog: { create: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
  };
  const mockAuthFn = vi.fn();
  return { mockPrisma, mockAuthFn };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: mockAuthFn }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createIssue, moveIssue, reorderIssues } from "@/app/(dashboard)/projects/[projectKey]/actions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockSession(userId = "user-1") {
  mockAuthFn.mockResolvedValue({ user: { id: userId, role: "TEAM_MEMBER" } });
}

function mockProjectMembership(projectId = "proj-1", orgId = "org-1", role = "PROJECT_LEAD") {
  mockPrisma.project.findUnique.mockResolvedValue({ id: projectId, key: "PRJ", orgId });
  mockPrisma.projectMember.findUnique.mockResolvedValue({ role });
}

// ─── createIssue: atomic key generation ──────────────────────────────────────

describe("createIssue — atomic key generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockProjectMembership();
    mockPrisma.activityLog.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)
    );
  });

  it("generates key as projectKey-N+1 based on highest existing key", async () => {
    mockPrisma.issue.count.mockResolvedValue(3);
    mockPrisma.issue.findFirst.mockResolvedValue({ key: "PRJ-3" });
    const created = { id: "issue-4", key: "PRJ-4" };
    mockPrisma.issue.create.mockResolvedValue(created);

    const result = await createIssue("PRJ", { title: "New issue" });

    expect(result.success).toBe(true);
    expect(result.issue.key).toBe("PRJ-4");
    expect(mockPrisma.issue.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ key: "PRJ-4" }) })
    );
  });

  it("generates key as projectKey-1 when project has no issues yet", async () => {
    mockPrisma.issue.count.mockResolvedValue(0);
    mockPrisma.issue.findFirst.mockResolvedValue(null);
    const created = { id: "issue-1", key: "PRJ-1" };
    mockPrisma.issue.create.mockResolvedValue(created);

    const result = await createIssue("PRJ", { title: "First issue" });

    expect(result.success).toBe(true);
    expect(mockPrisma.issue.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ key: "PRJ-1" }) })
    );
  });

  it("uses $transaction for atomic key gen and create", async () => {
    mockPrisma.issue.count.mockResolvedValue(0);
    mockPrisma.issue.findFirst.mockResolvedValue(null);
    mockPrisma.issue.create.mockResolvedValue({ id: "i1", key: "PRJ-1" });

    await createIssue("PRJ", { title: "Task" });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
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
    mockPrisma.issue.findUniqueOrThrow.mockResolvedValue({ id: "issue-1", status: "IN_PROGRESS", position: 0 });
    // moveIssue uses callback-style $transaction internally
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)
    );
  });

  it("compacts the source column after a cross-column move", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({ id: "issue-1", status: "TODO", position: 1 });
    mockPrisma.issue.findMany.mockResolvedValue([{ id: "other-1" }, { id: "other-2" }]);

    await moveIssue("PRJ", "issue-1", "IN_PROGRESS", 0);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    // Source column (TODO) compaction: findMany called with source status filter
    expect(mockPrisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "TODO" }),
        orderBy: { position: "asc" },
      })
    );
  });

  it("does not compact the source column when the issue moves within the same column", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({ id: "issue-1", status: "TODO", position: 0 });
    mockPrisma.issue.findMany.mockResolvedValue([]);

    await expect(moveIssue("PRJ", "issue-1", "TODO", 2)).resolves.toMatchObject({ success: true });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    // Only one findMany call (dest column); src compaction skipped when status is unchanged
    expect(mockPrisma.issue.findMany).toHaveBeenCalledTimes(1);
  });

  it("handles an empty source column gracefully after the last issue leaves", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({ id: "issue-1", status: "DONE", position: 0 });
    mockPrisma.issue.findMany.mockResolvedValue([]);

    await expect(moveIssue("PRJ", "issue-1", "IN_PROGRESS", 0)).resolves.toMatchObject({
      success: true,
    });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
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
