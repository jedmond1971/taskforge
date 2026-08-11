import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockPrisma, mockAuthFn } = vi.hoisted(() => {
  const mockPrisma = {
    project: { findUnique: vi.fn() },
    projectMember: { findUnique: vi.fn() },
    groupPermission: { findMany: vi.fn().mockResolvedValue([]) },
    projectStatus: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    issue: {
      count: vi.fn(),
      aggregate: vi.fn(),
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
    mockPrisma.projectStatus.findFirst.mockResolvedValue({ id: "status-todo" });
    mockPrisma.issue.aggregate.mockResolvedValue({ _max: { position: null } });
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)
    );
  });

  it("generates key as projectKey-N+1 based on highest existing key", async () => {
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
    mockPrisma.issue.findFirst.mockResolvedValue(null);
    mockPrisma.issue.create.mockResolvedValue({ id: "i1", key: "PRJ-1" });

    await createIssue("PRJ", { title: "Task" });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("computes position as MAX(position)+1 scoped to the target status, not COUNT(*) (JFR-122)", async () => {
    // A column with a gap (positions 0,1,3) has COUNT()===3, which would collide
    // with the existing row at position 3. MAX(position)+1 === 4 is always safe.
    mockPrisma.issue.aggregate.mockResolvedValue({ _max: { position: 3 } });
    mockPrisma.issue.findFirst.mockResolvedValue(null);
    mockPrisma.issue.create.mockResolvedValue({ id: "i1", key: "PRJ-1" });

    await createIssue("PRJ", { title: "Task" });

    expect(mockPrisma.issue.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: "proj-1", statusId: "status-todo" }),
        _max: { position: true },
      })
    );
    expect(mockPrisma.issue.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 4 }) })
    );
  });
});

// ─── moveIssue: cross-column source compaction ────────────────────────────────

describe("moveIssue — cross-column source column compaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockProjectMembership();
    mockPrisma.activityLog.create.mockResolvedValue({});
    mockPrisma.issue.update.mockResolvedValue({ id: "issue-1", statusId: "status-ip", position: 0 });
    mockPrisma.issue.findUniqueOrThrow.mockResolvedValue({
      id: "issue-1",
      statusId: "status-ip",
      position: 0,
      projectStatus: { id: "status-ip", name: "In Progress", category: "IN_PROGRESS" },
    });
    mockPrisma.projectStatus.findUnique.mockResolvedValue({ name: "In Progress" });
    // moveIssue uses callback-style $transaction internally
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)
    );
  });

  it("compacts the source column after a cross-column move", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({
      id: "issue-1",
      statusId: "status-todo",
      projectStatus: { name: "To Do" },
      position: 1,
    });
    mockPrisma.issue.findMany.mockResolvedValue([{ id: "other-1" }, { id: "other-2" }]);

    await moveIssue("PRJ", "issue-1", "status-ip", 0);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    // Source column compaction: findMany called with source statusId filter
    expect(mockPrisma.issue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ statusId: "status-todo" }),
        orderBy: { position: "asc" },
      })
    );
  });

  it("does not compact the source column when the issue moves within the same column", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({
      id: "issue-1",
      statusId: "status-todo",
      projectStatus: { name: "To Do" },
      position: 0,
    });
    mockPrisma.issue.findMany.mockResolvedValue([]);

    await expect(moveIssue("PRJ", "issue-1", "status-todo", 2)).resolves.toMatchObject({ success: true });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    // Only one findMany call (dest column); src compaction skipped when statusId is unchanged
    expect(mockPrisma.issue.findMany).toHaveBeenCalledTimes(1);
  });

  it("handles an empty source column gracefully after the last issue leaves", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({
      id: "issue-1",
      statusId: "status-done",
      projectStatus: { name: "Done" },
      position: 0,
    });
    mockPrisma.issue.findMany.mockResolvedValue([]);

    await expect(moveIssue("PRJ", "issue-1", "status-ip", 0)).resolves.toMatchObject({
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

// ─── moveIssue: sprint-scoped positioning (JFR-105) ────────────────────────────

describe("moveIssue — sprint-scoped positioning (JFR-105)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockProjectMembership();
    mockPrisma.activityLog.create.mockResolvedValue({});
    mockPrisma.issue.findUniqueOrThrow.mockResolvedValue({
      id: "issue-new",
      statusId: "status-todo",
      position: 0,
      projectStatus: { id: "status-todo", name: "To Do", category: "TODO" },
    });
    mockPrisma.projectStatus.findUnique.mockResolvedValue({ name: "To Do" });
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)
    );
  });

  it("inserts the moved issue among only the sprint-scoped items, leaving hidden (backlog) issues' relative order untouched", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({
      id: "issue-new",
      statusId: "status-todo", // same column as target: no source compaction
      projectStatus: { name: "To Do" },
      position: 0,
    });
    mockPrisma.issue.findMany.mockResolvedValue([
      { id: "backlog-1", sprintId: null },
      { id: "sprint-1", sprintId: "sprint-a" },
      { id: "backlog-2", sprintId: null },
      { id: "sprint-2", sprintId: "sprint-a" },
    ]);

    // newPosition=1 means "after the 1st visible (sprint-a) item" — visible
    // items are at absolute indices [1, 3], so the moved issue should land
    // at absolute slot 3, between backlog-2 and sprint-2.
    await moveIssue("PRJ", "issue-new", "status-todo", 1, "sprint-a");

    const positionCalls = mockPrisma.issue.update.mock.calls.filter(
      (c) => "position" in (c[0] as { data: Record<string, unknown> }).data
    ) as [{ where: { id: string }; data: { position: number } }][];

    expect(positionCalls.map((c) => c[0].where.id)).toEqual([
      "backlog-1",
      "sprint-1",
      "backlog-2",
      "issue-new",
      "sprint-2",
    ]);
    expect(positionCalls.map((c) => c[0].data.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it("falls back to legacy full-column clamping when sprintScopeId is omitted", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({
      id: "issue-new",
      statusId: "status-todo",
      projectStatus: { name: "To Do" },
      position: 0,
    });
    mockPrisma.issue.findMany.mockResolvedValue([
      { id: "other-1", sprintId: null },
      { id: "other-2", sprintId: null },
    ]);

    await moveIssue("PRJ", "issue-new", "status-todo", 1);

    const positionCalls = mockPrisma.issue.update.mock.calls.filter(
      (c) => "position" in (c[0] as { data: Record<string, unknown> }).data
    ) as [{ where: { id: string }; data: { position: number } }][];
    expect(positionCalls.map((c) => c[0].where.id)).toEqual(["other-1", "issue-new", "other-2"]);
  });
});

// ─── reorderIssues: sprint-scoped positioning (JFR-105) ────────────────────────

describe("reorderIssues — sprint-scoped positioning (JFR-105)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockProjectMembership();
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)
    );
    mockPrisma.issue.updateMany.mockResolvedValue({ count: 1 });
  });

  it("only writes positions for the visible subset, using the slots already occupied by sprint-scoped issues", async () => {
    mockPrisma.issue.findFirst.mockResolvedValue({ statusId: "status-todo" });
    mockPrisma.issue.findMany.mockResolvedValue([
      { id: "backlog-1", position: 0, sprintId: null },
      { id: "sprint-1", position: 1, sprintId: "sprint-a" },
      { id: "backlog-2", position: 2, sprintId: null },
      { id: "sprint-2", position: 3, sprintId: "sprint-a" },
    ]);

    // Visible subset reordered: sprint-2 now before sprint-1.
    await reorderIssues("PRJ", ["sprint-2", "sprint-1"], "sprint-a");

    expect(mockPrisma.issue.updateMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.issue.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ id: "sprint-2" }), data: { position: 1 } })
    );
    expect(mockPrisma.issue.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ id: "sprint-1" }), data: { position: 3 } })
    );
    // Hidden (backlog) issues are never written.
    const writtenIds = mockPrisma.issue.updateMany.mock.calls.map(
      (c) => (c[0] as { where: { id: string } }).where.id
    );
    expect(writtenIds).not.toContain("backlog-1");
    expect(writtenIds).not.toContain("backlog-2");
  });
});
