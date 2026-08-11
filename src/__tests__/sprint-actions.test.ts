import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockPrisma, mockAuthFn } = vi.hoisted(() => {
  const mockPrisma = {
    project: { findUniqueOrThrow: vi.fn() },
    projectMember: { findUnique: vi.fn() },
    groupPermission: { findMany: vi.fn().mockResolvedValue([]) },
    projectStatus: { findMany: vi.fn() },
    sprint: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    issue: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const mockAuthFn = vi.fn();
  return { mockPrisma, mockAuthFn };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: mockAuthFn }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createSprint, startSprint, completeSprint } from "@/app/(dashboard)/projects/[projectKey]/sprint-actions";
// Real Prisma.PrismaClientKnownRequestError — a plain class, no DB connection
// needed to construct it, so it doesn't need mocking like `prisma` does.
import { Prisma } from "@prisma/client";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockSession(userId = "user-1") {
  mockAuthFn.mockResolvedValue({ user: { id: userId, role: "TEAM_MEMBER" } });
}

// requireProjectRole (called first, inside permissions.ts) reads the project
// via prisma.project.findUnique; the sprint-actions' own assertSprintMode
// guard then reads workflowMode via prisma.project.findUniqueOrThrow. Both
// need stubbing for any action under test to get past its guards.
function mockLeadMembership(projectId = "proj-1", orgId = "org-1") {
  (mockPrisma.project as Record<string, unknown>).findUnique = vi
    .fn()
    .mockResolvedValue({ id: projectId, key: "PRJ", orgId, isPrivate: false });
  mockPrisma.project.findUniqueOrThrow.mockResolvedValue({ workflowMode: "SPRINT" });
  mockPrisma.projectMember.findUnique.mockResolvedValue({ role: "PROJECT_LEAD" });
}

describe("createSprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockLeadMembership();
  });

  it("rejects an empty name", async () => {
    const result = await createSprint("PRJ", { name: "   " });
    expect(result).toEqual({ success: false, error: "Sprint name cannot be empty." });
    expect(mockPrisma.sprint.create).not.toHaveBeenCalled();
  });

  it("rejects a second open sprint", async () => {
    mockPrisma.sprint.findFirst.mockResolvedValue({ id: "existing-sprint" });

    const result = await createSprint("PRJ", { name: "Sprint 2" });

    expect(result).toEqual({ success: false, error: "This project already has an open sprint." });
    expect(mockPrisma.sprint.create).not.toHaveBeenCalled();
  });

  it("creates a PLANNED sprint when no open sprint exists", async () => {
    mockPrisma.sprint.findFirst.mockResolvedValue(null);
    mockPrisma.sprint.create.mockResolvedValue({ id: "sprint-1", name: "Sprint 1", status: "PLANNED" });

    const result = await createSprint("PRJ", { name: "Sprint 1" });

    expect(result.success).toBe(true);
    expect(mockPrisma.sprint.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PLANNED", name: "Sprint 1" }) })
    );
  });
});

describe("startSprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockLeadMembership();
  });

  it("rejects when another sprint is already ACTIVE (app-level pre-check)", async () => {
    mockPrisma.sprint.findFirst
      .mockResolvedValueOnce({ id: "sprint-1", status: "PLANNED", startDate: null }) // target lookup
      .mockResolvedValueOnce({ id: "sprint-active" }); // active-already check

    const result = await startSprint("PRJ", "sprint-1");

    expect(result).toEqual({ success: false, error: "This project already has an active sprint." });
    expect(mockPrisma.sprint.update).not.toHaveBeenCalled();
  });

  it("returns a clean error when the partial unique index rejects a concurrent start (P2002)", async () => {
    mockPrisma.sprint.findFirst
      .mockResolvedValueOnce({ id: "sprint-1", status: "PLANNED", startDate: null })
      .mockResolvedValueOnce(null); // pre-check passed
    mockPrisma.sprint.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique constraint", { code: "P2002", clientVersion: "5.22.0" })
    );

    const result = await startSprint("PRJ", "sprint-1");

    expect(result).toEqual({ success: false, error: "This project already has an active sprint." });
  });

  it("starts a PLANNED sprint and sets startDate", async () => {
    mockPrisma.sprint.findFirst
      .mockResolvedValueOnce({ id: "sprint-1", status: "PLANNED", startDate: null })
      .mockResolvedValueOnce(null);
    mockPrisma.sprint.update.mockResolvedValue({ id: "sprint-1", status: "ACTIVE" });

    const result = await startSprint("PRJ", "sprint-1");

    expect(result.success).toBe(true);
    expect(mockPrisma.sprint.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ACTIVE" }) })
    );
  });
});

describe("completeSprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockLeadMembership();
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)
    );
  });

  it("only unassigns issues not in a DONE-category status", async () => {
    mockPrisma.sprint.findFirst.mockResolvedValue({ id: "sprint-1", status: "ACTIVE", endDate: null });
    mockPrisma.projectStatus.findMany.mockResolvedValue([{ id: "status-done" }]);
    mockPrisma.issue.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.sprint.update.mockResolvedValue({ id: "sprint-1", status: "COMPLETED" });

    const result = await completeSprint("PRJ", "sprint-1");

    expect(result).toEqual({ success: true, movedToBacklogCount: 2 });
    expect(mockPrisma.issue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sprintId: "sprint-1", statusId: { notIn: ["status-done"] } }),
        data: { sprintId: null },
      })
    );
    expect(mockPrisma.sprint.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) })
    );
  });

  it("unassigns every sprint issue when the project has no DONE-category status", async () => {
    mockPrisma.sprint.findFirst.mockResolvedValue({ id: "sprint-1", status: "ACTIVE", endDate: null });
    mockPrisma.projectStatus.findMany.mockResolvedValue([]);
    mockPrisma.issue.updateMany.mockResolvedValue({ count: 5 });
    mockPrisma.sprint.update.mockResolvedValue({ id: "sprint-1", status: "COMPLETED" });

    const result = await completeSprint("PRJ", "sprint-1");

    expect(result).toEqual({ success: true, movedToBacklogCount: 5 });
    expect(mockPrisma.issue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ statusId: { notIn: [] } }) })
    );
  });

  it("rejects completing a sprint that isn't ACTIVE", async () => {
    mockPrisma.sprint.findFirst.mockResolvedValue({ id: "sprint-1", status: "PLANNED", endDate: null });

    const result = await completeSprint("PRJ", "sprint-1");

    expect(result).toEqual({ success: false, error: "Only the active sprint can be completed." });
    expect(mockPrisma.issue.updateMany).not.toHaveBeenCalled();
  });
});
