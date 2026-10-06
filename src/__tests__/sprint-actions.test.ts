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

  const base = { name: "Sprint 1", duration: "2w" as const, startDate: "2026-04-01" }; // a Wednesday

  it("rejects an empty name", async () => {
    const result = await createSprint("PRJ", { ...base, name: "   " });
    expect(result).toEqual({ success: false, error: "Sprint name cannot be empty." });
    expect(mockPrisma.sprint.create).not.toHaveBeenCalled();
  });

  it("allows a second open sprint — only ACTIVE is limited, and startSprint enforces that", async () => {
    mockPrisma.sprint.findFirst.mockResolvedValue({ id: "existing-sprint" });
    mockPrisma.sprint.create.mockResolvedValue({ id: "sprint-2" });

    const result = await createSprint("PRJ", { ...base, name: "Sprint 2" });

    expect(result.success).toBe(true);
    expect(mockPrisma.sprint.create).toHaveBeenCalled();
  });

  it("creates a PLANNED sprint and computes the end date from business days", async () => {
    mockPrisma.sprint.create.mockResolvedValue({ id: "sprint-1" });

    const result = await createSprint("PRJ", { ...base, goal: " ship it " });

    expect(result.success).toBe(true);
    expect(mockPrisma.sprint.create).toHaveBeenCalledWith({
      data: {
        projectId: "proj-1",
        name: "Sprint 1",
        goal: "ship it",
        status: "PLANNED",
        startDate: new Date("2026-04-01T00:00:00Z"),
        endDate: new Date("2026-04-14T00:00:00Z"), // Wed 1st + 10 business days = Tue 14th
      },
    });
  });

  it("ignores a client-supplied end date for a preset duration", async () => {
    mockPrisma.sprint.create.mockResolvedValue({ id: "sprint-1" });
    await createSprint("PRJ", { ...base, endDate: "2027-01-01" });
    expect(mockPrisma.sprint.create.mock.calls[0][0].data.endDate).toEqual(new Date("2026-04-14T00:00:00Z"));
  });

  it("uses the supplied dates for a custom duration", async () => {
    mockPrisma.sprint.create.mockResolvedValue({ id: "sprint-1" });
    await createSprint("PRJ", { ...base, duration: "custom", startDate: "2026-04-04", endDate: "2026-04-20" });
    const data = mockPrisma.sprint.create.mock.calls[0][0].data;
    expect(data.startDate).toEqual(new Date("2026-04-04T00:00:00Z")); // a Saturday is fine when custom
    expect(data.endDate).toEqual(new Date("2026-04-20T00:00:00Z"));
  });

  it.each([
    ["a custom sprint with no end date", { duration: "custom" as const }, "Enter a valid end date."],
    ["a custom end before the start", { duration: "custom" as const, endDate: "2026-03-31" }, "The end date cannot be before the start date."],
    ["a preset starting on a weekend", { startDate: "2026-04-04" }, "A sprint must start on a weekday."],
    ["an unparseable start date", { startDate: "nope" }, "Enter a valid start date."],
    ["an unknown duration", { duration: "constructor" as never }, "Choose a sprint duration."],
  ])("rejects %s", async (_label, override, error) => {
    const result = await createSprint("PRJ", { ...base, ...override });
    expect(result).toEqual({ success: false, error });
    expect(mockPrisma.sprint.create).not.toHaveBeenCalled();
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
