import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks (available before vi.mock factories run) ───────────────────

const { mockPrisma, mockAuthFn } = vi.hoisted(() => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    orgMember: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    projectMember: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    projectStatus: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    issue: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    activityLog: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    notification: {
      create: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({}),
    },
    adminAuditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
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
vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed"), compare: vi.fn() },
}));
vi.mock("@/lib/issue-keys", () => ({
  generateIssueKeyWithRetry: vi.fn().mockResolvedValue("PRJ-1"),
}));

// ─── Static imports (resolved after mocks are hoisted) ────────────────────────

import { NextRequest } from "next/server";
import { POST } from "@/app/api/auth/register/route";
import { POST as postProjects } from "@/app/api/projects/route";
import { PATCH as patchIssue } from "@/app/api/issues/[issueId]/route";
import {
  searchUsers,
  addProjectMember,
  createUserAndAddToProject,
  createIssue,
  updateIssue,
} from "@/app/(dashboard)/projects/[projectKey]/actions";
import { adminDeleteOrg, adminRemoveOrgMember } from "@/app/(dashboard)/admin/actions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

function mockSession(userId = "user-1", orgId = "org-1") {
  mockAuthFn.mockResolvedValue({ user: { id: userId, role: "TEAM_MEMBER", orgId } });
}

function mockProjectWithOrg(projectId = "proj-1", orgId = "org-1") {
  mockPrisma.project.findUnique.mockResolvedValue({ id: projectId, key: "PRJ", orgId });
  mockPrisma.projectMember.findUnique.mockResolvedValue({ role: "PROJECT_LEAD" });
}

// ─── 1. Registration ──────────────────────────────────────────────────────────

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 — self-registration is disabled", async () => {
    const res = await POST();
    expect(res.status).toBe(403);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });
});

// ─── 2. searchUsers scoped to org ────────────────────────────────────────────

describe("searchUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockProjectWithOrg();
  });

  it("only returns org members who are not already project members", async () => {
    mockPrisma.projectMember.findMany.mockResolvedValue([{ userId: "user-2" }]);
    mockPrisma.orgMember.findMany.mockResolvedValue([{ userId: "user-3" }]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: "user-3", name: "Bob", email: "bob@org.com" }]);

    await searchUsers("bob", "PRJ");

    expect(mockPrisma.orgMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org-1",
          userId: { notIn: ["user-2"] },
        }),
      })
    );
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["user-3"] } }),
      })
    );
  });

  it("does not expose users from other orgs", async () => {
    mockPrisma.projectMember.findMany.mockResolvedValue([]);
    mockPrisma.orgMember.findMany.mockResolvedValue([]); // no org members match
    mockPrisma.user.findMany.mockResolvedValue([]);

    await searchUsers("eve", "PRJ");

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: [] } }) })
    );
  });
});

// ─── 3. addProjectMember enforces org membership ─────────────────────────────

describe("addProjectMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockProjectWithOrg();
  });

  it("rejects a user from another org", async () => {
    mockPrisma.orgMember.findUnique.mockResolvedValue(null); // not in org

    await expect(addProjectMember("PRJ", "outsider-id", "TEAM_MEMBER")).rejects.toThrow(
      "not a member of this organization"
    );
    expect(mockPrisma.projectMember.create).not.toHaveBeenCalled();
  });

  it("rejects a user already in the project", async () => {
    mockPrisma.orgMember.findUnique.mockResolvedValue({ role: "MEMBER" });
    mockPrisma.projectMember.findUnique
      .mockResolvedValueOnce({ role: "PROJECT_LEAD" }) // caller's requireProjectRole check
      .mockResolvedValueOnce({ role: "TEAM_MEMBER" }); // already a project member

    await expect(addProjectMember("PRJ", "user-2", "TEAM_MEMBER")).rejects.toThrow("already a project member");
    expect(mockPrisma.projectMember.create).not.toHaveBeenCalled();
  });

  it("succeeds for a valid org member not yet in the project", async () => {
    mockPrisma.orgMember.findUnique.mockResolvedValue({ role: "MEMBER" });
    mockPrisma.projectMember.findUnique
      .mockResolvedValueOnce({ role: "PROJECT_LEAD" }) // caller is project lead
      .mockResolvedValueOnce(null); // target not yet in project
    mockPrisma.projectMember.create.mockResolvedValue({});

    const result = await addProjectMember("PRJ", "user-2", "TEAM_MEMBER");
    expect(result).toEqual({ success: true });
    expect(mockPrisma.projectMember.create).toHaveBeenCalled();
  });
});

// ─── 4. createUserAndAddToProject creates OrgMember + ProjectMember ──────────

describe("createUserAndAddToProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockProjectWithOrg();
    mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => Promise<unknown>) =>
      fn(mockPrisma)
    );
  });

  it("creates user, OrgMember, and ProjectMember in a transaction", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: "new-user" });
    mockPrisma.orgMember.create.mockResolvedValue({});
    mockPrisma.projectMember.create.mockResolvedValue({});

    const result = await createUserAndAddToProject("PRJ", {
      name: "Carol",
      email: "carol@org.com",
      password: "pass",
      role: "TEAM_MEMBER",
    });

    expect(result).toEqual({ success: true });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.orgMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: "org-1", userId: "new-user" }) })
    );
    expect(mockPrisma.projectMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "new-user", projectId: "proj-1" }),
      })
    );
  });

  it("rejects if email already exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "existing" });

    await expect(
      createUserAndAddToProject("PRJ", {
        name: "Carol",
        email: "taken@org.com",
        password: "pass",
        role: "TEAM_MEMBER",
      })
    ).rejects.toThrow("already exists");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

// ─── 5. createIssue / updateIssue reject non-member assignees ────────────────

describe("createIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockProjectWithOrg();
    mockPrisma.issue.count.mockResolvedValue(0);
    mockPrisma.issue.findFirst.mockResolvedValue(null);
    mockPrisma.projectStatus.findFirst.mockResolvedValue({ id: "status-todo" });
    mockPrisma.$transaction.mockImplementation(
      (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma)
    );
  });

  it("rejects an assignee who is not a project member", async () => {
    mockPrisma.projectMember.findUnique
      .mockResolvedValueOnce({ role: "PROJECT_LEAD" }) // caller check
      .mockResolvedValueOnce(null); // assignee not in project

    await expect(createIssue("PRJ", { title: "Bug", assigneeId: "outsider" })).rejects.toThrow(
      "not a member of this project"
    );
  });

  it("allows null assignee without validation", async () => {
    mockPrisma.projectMember.findUnique.mockResolvedValueOnce({ role: "PROJECT_LEAD" });
    mockPrisma.issue.create.mockResolvedValue({ id: "i1", key: "PRJ-1" });

    const result = await createIssue("PRJ", { title: "Task" });
    expect(result.success).toBe(true);
  });
});

describe("updateIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
    mockProjectWithOrg();
  });

  it("rejects an assignee who is not a project member", async () => {
    mockPrisma.projectMember.findUnique
      .mockResolvedValueOnce({ role: "PROJECT_LEAD" }) // caller check
      .mockResolvedValueOnce(null); // assignee not in project

    await expect(updateIssue("PRJ", "issue-1", { assigneeId: "outsider" })).rejects.toThrow(
      "not a member of this project"
    );
  });

  it("allows null assigneeId to unassign", async () => {
    mockPrisma.projectMember.findUnique.mockResolvedValueOnce({ role: "PROJECT_LEAD" });
    mockPrisma.issue.findFirst.mockResolvedValue({
      id: "issue-1",
      title: "T",
      status: "TODO",
      priority: "MEDIUM",
      type: "TASK",
      labels: [],
      assignee: null,
      project: { key: "PRJ" },
      key: "PRJ-1",
    });
    mockPrisma.issue.update.mockResolvedValue({ id: "issue-1" });

    const result = await updateIssue("PRJ", "issue-1", { assigneeId: null });
    expect(result.success).toBe(true);
  });
});

// ─── 6. adminRemoveOrgMember blocks when user has project memberships ─────────

describe("adminRemoveOrgMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthFn.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    mockPrisma.organization.findUnique.mockResolvedValue({ ownerId: "other-user" });
  });

  it("throws when the user still belongs to projects in the org", async () => {
    mockPrisma.projectMember.count.mockResolvedValue(2);

    await expect(adminRemoveOrgMember("org-1", "user-2")).rejects.toThrow(
      "still belong to 2 project(s)"
    );
    expect(mockPrisma.orgMember.delete).not.toHaveBeenCalled();
  });

  it("succeeds when the user has no project memberships in the org", async () => {
    mockPrisma.projectMember.count.mockResolvedValue(0);
    mockPrisma.orgMember.delete.mockResolvedValue({});

    const result = await adminRemoveOrgMember("org-1", "user-2");
    expect(result).toEqual({ success: true });
    expect(mockPrisma.orgMember.delete).toHaveBeenCalledWith({
      where: { orgId_userId: { orgId: "org-1", userId: "user-2" } },
    });
  });

  it("throws when trying to remove the org owner", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ ownerId: "user-2" });

    await expect(adminRemoveOrgMember("org-1", "user-2")).rejects.toThrow("Cannot remove the org owner");
    expect(mockPrisma.projectMember.count).not.toHaveBeenCalled();
  });
});

// ─── 7. POST /api/projects rejects stale-session orgId ───────────────────────

describe("POST /api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthFn.mockResolvedValue({ user: { id: "user-1", orgId: "org-1", role: "MEMBER" } });
  });

  it("returns 403 when the session orgId is no longer a valid OrgMember", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null); // key not taken
    mockPrisma.orgMember.findUnique.mockResolvedValue(null); // membership revoked

    const res = await postProjects(makeRequest({ name: "Test Project", key: "TST" }));
    expect(res.status).toBe(403);
    expect(mockPrisma.project.create).not.toHaveBeenCalled();
  });

  it("creates project when OrgMember row is present", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);
    mockPrisma.orgMember.findUnique.mockResolvedValue({ role: "OWNER" });
    mockPrisma.project.create.mockResolvedValue({ id: "proj-1", name: "Test Project", key: "TST" });

    const res = await postProjects(makeRequest({ name: "Test Project", key: "TST" }));
    expect(res.status).toBe(201);
    expect(mockPrisma.project.create).toHaveBeenCalled();
  });
});

// ─── 8. PATCH /api/issues/[issueId] validates assigneeId ─────────────────────

describe("PATCH /api/issues/[issueId]", () => {
  const mockIssue = {
    id: "issue-1",
    title: "Bug",
    status: "TODO",
    priority: "MEDIUM",
    type: "TASK",
    assigneeId: null,
    labels: [],
    project: { id: "proj-1" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthFn.mockResolvedValue({ user: { id: "user-1", role: "TEAM_MEMBER", orgId: "org-1" } });
    mockPrisma.issue.findUnique.mockResolvedValue(mockIssue);
    mockPrisma.projectMember.findUnique.mockResolvedValue({ role: "TEAM_MEMBER" }); // caller is a member
  });

  it("returns 400 when assigneeId is not a project member", async () => {
    mockPrisma.projectMember.findUnique
      .mockResolvedValueOnce({ role: "TEAM_MEMBER" }) // caller check
      .mockResolvedValueOnce(null); // assignee check

    const res = await patchIssue(
      makeRequest({ assigneeId: "outsider" }),
      { params: { issueId: "issue-1" } }
    );
    expect(res.status).toBe(400);
    expect(mockPrisma.issue.update).not.toHaveBeenCalled();
  });

  it("allows null assigneeId without validation", async () => {
    mockPrisma.issue.update.mockResolvedValue({ ...mockIssue, assigneeId: null });
    mockPrisma.activityLog.createMany = vi.fn().mockResolvedValue({});

    const res = await patchIssue(
      makeRequest({ assigneeId: null }),
      { params: { issueId: "issue-1" } }
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.issue.update).toHaveBeenCalled();
  });

  it("accepts a valid assigneeId that is a project member", async () => {
    mockPrisma.projectMember.findUnique
      .mockResolvedValueOnce({ role: "TEAM_MEMBER" }) // caller check
      .mockResolvedValueOnce({ role: "TEAM_MEMBER" }); // assignee is a member
    mockPrisma.issue.update.mockResolvedValue({ ...mockIssue, assigneeId: "user-2" });
    mockPrisma.activityLog.createMany = vi.fn().mockResolvedValue({});

    const res = await patchIssue(
      makeRequest({ assigneeId: "user-2" }),
      { params: { issueId: "issue-1" } }
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.issue.update).toHaveBeenCalled();
  });
});

// ─── 9. adminDeleteOrg blocks when projects exist ────────────────────────────

describe("adminDeleteOrg", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthFn.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  });

  it("throws when the org has projects", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      name: "Acme Corp",
      _count: { projects: 3 },
    });

    await expect(adminDeleteOrg("org-1")).rejects.toThrow("still has 3 project(s)");
    expect(mockPrisma.organization.delete).not.toHaveBeenCalled();
  });

  it("succeeds when the org has no projects", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      name: "Empty Org",
      _count: { projects: 0 },
    });
    mockPrisma.organization.delete.mockResolvedValue({});

    const result = await adminDeleteOrg("org-1");
    expect(result).toEqual({ success: true });
    expect(mockPrisma.organization.delete).toHaveBeenCalledWith({ where: { id: "org-1" } });
  });
});
