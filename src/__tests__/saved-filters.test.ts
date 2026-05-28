import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockPrisma, mockAuthFn } = vi.hoisted(() => {
  const mockPrisma = {
    savedFilter: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    projectMember: {
      findUnique: vi.fn(),
    },
  };
  const mockAuthFn = vi.fn();
  return { mockPrisma, mockAuthFn };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: mockAuthFn }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveFilter, updateFilter, deleteFilter } from "@/app/(dashboard)/search/filter-actions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockSession(role: "ADMIN" | "TEAM_MEMBER" = "TEAM_MEMBER", userId = "user-1") {
  mockAuthFn.mockResolvedValue({ user: { id: userId, role } });
}

// ─── saveFilter ───────────────────────────────────────────────────────────────

describe("saveFilter — global flag permission", () => {
  const PROJECT_ID = "project-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.savedFilter.create.mockResolvedValue({ id: "f1" });
    mockPrisma.projectMember.findUnique.mockResolvedValue({ id: "pm-1" });
  });

  it("allows ADMIN to create a global filter", async () => {
    mockSession("ADMIN");
    await expect(saveFilter("My filter", "status = TODO", true, PROJECT_ID)).resolves.toBeDefined();
    expect(mockPrisma.savedFilter.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isGlobal: true }) })
    );
  });

  it("denies MEMBER from creating a global filter", async () => {
    mockSession("TEAM_MEMBER");
    await expect(saveFilter("My filter", "status = TODO", true, PROJECT_ID)).rejects.toThrow("Forbidden");
    expect(mockPrisma.savedFilter.create).not.toHaveBeenCalled();
  });

  it("allows MEMBER to create a personal (non-global) filter", async () => {
    mockSession("TEAM_MEMBER");
    await expect(saveFilter("My filter", "status = TODO", false, PROJECT_ID)).resolves.toBeDefined();
    expect(mockPrisma.savedFilter.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isGlobal: false }) })
    );
  });
});

// ─── updateFilter ─────────────────────────────────────────────────────────────

describe("updateFilter — global flag and ownership permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.savedFilter.update.mockResolvedValue({ id: "f1" });
  });

  it("denies MEMBER from editing an existing global filter", async () => {
    mockSession("TEAM_MEMBER", "user-1");
    mockPrisma.savedFilter.findUnique.mockResolvedValue({
      id: "f1",
      userId: "user-1",
      isGlobal: true,
    });

    await expect(updateFilter("f1", { name: "New name" })).rejects.toThrow("Forbidden");
    expect(mockPrisma.savedFilter.update).not.toHaveBeenCalled();
  });

  it("denies MEMBER from promoting a personal filter to global", async () => {
    mockSession("TEAM_MEMBER", "user-1");
    mockPrisma.savedFilter.findUnique.mockResolvedValue({
      id: "f1",
      userId: "user-1",
      isGlobal: false,
    });

    await expect(updateFilter("f1", { isGlobal: true })).rejects.toThrow("Forbidden");
    expect(mockPrisma.savedFilter.update).not.toHaveBeenCalled();
  });

  it("allows ADMIN to edit a global filter", async () => {
    mockSession("ADMIN", "admin-1");
    mockPrisma.savedFilter.findUnique.mockResolvedValue({
      id: "f1",
      userId: "admin-1",
      isGlobal: true,
    });

    await expect(updateFilter("f1", { name: "Updated" })).resolves.toBeDefined();
    expect(mockPrisma.savedFilter.update).toHaveBeenCalled();
  });

  it("allows ADMIN to promote a personal filter to global", async () => {
    mockSession("ADMIN", "admin-1");
    mockPrisma.savedFilter.findUnique.mockResolvedValue({
      id: "f1",
      userId: "admin-1",
      isGlobal: false,
    });

    await expect(updateFilter("f1", { isGlobal: true })).resolves.toBeDefined();
    expect(mockPrisma.savedFilter.update).toHaveBeenCalled();
  });

  it("denies editing another user's filter regardless of role", async () => {
    mockSession("TEAM_MEMBER", "user-2");
    mockPrisma.savedFilter.findUnique.mockResolvedValue({
      id: "f1",
      userId: "user-1",
      isGlobal: false,
    });

    await expect(updateFilter("f1", { name: "Hijack" })).rejects.toThrow("Forbidden");
    expect(mockPrisma.savedFilter.update).not.toHaveBeenCalled();
  });
});

// ─── deleteFilter ─────────────────────────────────────────────────────────────

describe("deleteFilter — ownership check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.savedFilter.delete.mockResolvedValue({ id: "f1" });
  });

  it("allows the owner to delete their own filter", async () => {
    mockSession("TEAM_MEMBER", "user-1");
    mockPrisma.savedFilter.findUnique.mockResolvedValue({ id: "f1", userId: "user-1" });

    await expect(deleteFilter("f1")).resolves.toMatchObject({ success: true });
    expect(mockPrisma.savedFilter.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
  });

  it("denies deleting another user's filter", async () => {
    mockSession("TEAM_MEMBER", "user-2");
    mockPrisma.savedFilter.findUnique.mockResolvedValue({ id: "f1", userId: "user-1" });

    await expect(deleteFilter("f1")).rejects.toThrow("Forbidden");
    expect(mockPrisma.savedFilter.delete).not.toHaveBeenCalled();
  });
});
