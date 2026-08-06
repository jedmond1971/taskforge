import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks (available before vi.mock factories run) ───────────────────

const { mockPrisma, mockAuthFn } = vi.hoisted(() => {
  const mockPrisma = {
    orgMember: { findUnique: vi.fn() },
    group: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    groupMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    groupPermission: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]), // requireOrgRole's own getUserGrants call
      create: vi.fn(),
      delete: vi.fn(),
    },
    project: { findFirst: vi.fn(), findUnique: vi.fn() },
  };
  const mockAuthFn = vi.fn();
  return { mockPrisma, mockAuthFn };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: mockAuthFn }));

// ─── Static imports (resolved after mocks are hoisted) ────────────────────────

import {
  addGroupMember,
  setGroupPermission,
  createGroup,
} from "@/app/(dashboard)/org-settings/group-actions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockSession(userId = "user-1") {
  mockAuthFn.mockResolvedValue({ user: { id: userId, role: "TEAM_MEMBER" } });
}

function mockCallerRole(role: "OWNER" | "ADMIN" | "MEMBER") {
  mockPrisma.orgMember.findUnique.mockResolvedValue({ role });
}

const ORG_ID = "org-1";
const GROUP_ID = "group-1";

beforeEach(() => {
  vi.clearAllMocks();
  mockSession();
  mockCallerRole("OWNER"); // caller passes canManageGroups by default
  mockPrisma.group.findFirst.mockResolvedValue({ id: GROUP_ID, orgId: ORG_ID, name: "QA Leads" });
});

// ─── canManageGroups gate ──────────────────────────────────────────────────────

describe("Group actions require canManageGroups (OWNER/ADMIN only, not boostable)", () => {
  it("rejects a plain MEMBER caller", async () => {
    mockCallerRole("MEMBER");
    await expect(createGroup(ORG_ID, "New Group")).rejects.toThrow("Forbidden");
    expect(mockPrisma.group.create).not.toHaveBeenCalled();
  });

  it("allows an OWNER caller", async () => {
    mockPrisma.group.findUnique.mockResolvedValue(null); // no name collision
    mockPrisma.group.create.mockResolvedValue({
      id: GROUP_ID,
      name: "New Group",
      createdAt: new Date(),
      members: [],
      grants: [],
    });

    const result = await createGroup(ORG_ID, "New Group");
    expect(result.success).toBe(true);
    expect(mockPrisma.group.create).toHaveBeenCalled();
  });
});

// ─── addGroupMember mirrors addProjectMember's OrgMember tenancy check ────────

describe("addGroupMember", () => {
  it("rejects a user who is not an OrgMember of this org", async () => {
    mockPrisma.orgMember.findUnique
      .mockResolvedValueOnce({ role: "OWNER" }) // caller's canManageGroups check
      .mockResolvedValueOnce(null); // target user has no OrgMember row

    const result = await addGroupMember(ORG_ID, GROUP_ID, "outsider-id");
    expect(result).toEqual({ success: false, error: "User is not a member of this organization" });
    expect(mockPrisma.groupMember.create).not.toHaveBeenCalled();
  });

  it("rejects a user already in the group", async () => {
    mockPrisma.orgMember.findUnique
      .mockResolvedValueOnce({ role: "OWNER" })
      .mockResolvedValueOnce({ role: "MEMBER" }); // target is an org member
    mockPrisma.groupMember.findUnique.mockResolvedValue({ id: "gm-1" }); // already in group

    const result = await addGroupMember(ORG_ID, GROUP_ID, "user-2");
    expect(result).toEqual({ success: false, error: "User is already in this group" });
    expect(mockPrisma.groupMember.create).not.toHaveBeenCalled();
  });

  it("succeeds for a valid org member not yet in the group", async () => {
    mockPrisma.orgMember.findUnique
      .mockResolvedValueOnce({ role: "OWNER" })
      .mockResolvedValueOnce({ role: "MEMBER" });
    mockPrisma.groupMember.findUnique.mockResolvedValue(null);
    mockPrisma.groupMember.create.mockResolvedValue({});

    const result = await addGroupMember(ORG_ID, GROUP_ID, "user-2");
    expect(result).toEqual({ success: true });
    expect(mockPrisma.groupMember.create).toHaveBeenCalledWith({
      data: { groupId: GROUP_ID, userId: "user-2" },
    });
  });

  it("rejects a group that doesn't belong to this org", async () => {
    mockPrisma.group.findFirst.mockResolvedValue(null); // no group matches {id, orgId}

    const result = await addGroupMember(ORG_ID, "other-orgs-group", "user-2");
    expect(result).toEqual({ success: false, error: "Group not found" });
    expect(mockPrisma.orgMember.findUnique).toHaveBeenCalledTimes(1); // only the caller's own check ran
  });
});

// ─── setGroupPermission validates project scoping ─────────────────────────────

describe("setGroupPermission", () => {
  it("rejects a projectId for an org-level permission", async () => {
    const result = await setGroupPermission(ORG_ID, GROUP_ID, "ORG_MANAGE_API_KEYS", "project-1");
    expect(result).toEqual({
      success: false,
      error: "This permission is org-wide and cannot be scoped to a project",
    });
    expect(mockPrisma.groupPermission.create).not.toHaveBeenCalled();
  });

  it("rejects a project that belongs to a different org", async () => {
    mockPrisma.project.findFirst.mockResolvedValue(null); // no project matches {id, orgId}

    const result = await setGroupPermission(ORG_ID, GROUP_ID, "ISSUE_EDIT", "other-orgs-project");
    expect(result).toEqual({ success: false, error: "Project not found in this organization" });
    expect(mockPrisma.groupPermission.create).not.toHaveBeenCalled();
  });

  it("grants a project-scoped permission for a project in the same org", async () => {
    mockPrisma.project.findFirst.mockResolvedValue({ id: "project-1", orgId: ORG_ID });
    mockPrisma.groupPermission.findFirst.mockResolvedValue(null); // no existing duplicate
    mockPrisma.groupPermission.create.mockResolvedValue({
      id: "grant-1",
      permission: "ISSUE_EDIT",
      projectId: "project-1",
      project: { name: "Product Launch" },
    });

    const result = await setGroupPermission(ORG_ID, GROUP_ID, "ISSUE_EDIT", "project-1");
    expect(result).toEqual({
      success: true,
      grant: { id: "grant-1", permission: "ISSUE_EDIT", projectId: "project-1", projectName: "Product Launch" },
    });
  });

  it("is idempotent for a duplicate org-wide grant (Postgres NULL-uniqueness gap)", async () => {
    mockPrisma.groupPermission.findFirst.mockResolvedValue({
      id: "existing-grant",
      permission: "ISSUE_EDIT",
      projectId: null,
    });

    const result = await setGroupPermission(ORG_ID, GROUP_ID, "ISSUE_EDIT", null);
    expect(result.success).toBe(true);
    expect(mockPrisma.groupPermission.create).not.toHaveBeenCalled();
  });
});
