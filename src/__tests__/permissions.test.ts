import { describe, it, expect, vi, beforeEach } from "vitest";

// permissions.ts imports auth and prisma (used in requireProjectRole/requireOrgRole
// and getUserGrants, not the pure canX helpers) — mock them to prevent transitive
// next/server resolution errors in the test runner.
const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { groupPermission: { findMany: mockFindMany } } }));
import {
  canManageProject,
  canEditSettings,
  canManageMembers,
  canEditIssues,
  canViewProject,
  canComment,
  canManageCustomFields,
  canManageApiKeys,
  canManageGroups,
  getUserGrants,
} from "@/lib/permissions";
import type { ProjectRole, Permission } from "@/lib/permissions";

const ALL_ROLES: ProjectRole[] = ["PROJECT_LEAD", "TEAM_MEMBER", "VIEWER"];

describe("canManageProject — PROJECT_LEAD only", () => {
  it("allows PROJECT_LEAD", () => expect(canManageProject("PROJECT_LEAD")).toBe(true));
  it("denies TEAM_MEMBER", () => expect(canManageProject("TEAM_MEMBER")).toBe(false));
  it("denies VIEWER", () => expect(canManageProject("VIEWER")).toBe(false));
});

describe("canEditSettings — PROJECT_LEAD only", () => {
  it("allows PROJECT_LEAD", () => expect(canEditSettings("PROJECT_LEAD")).toBe(true));
  it("denies TEAM_MEMBER", () => expect(canEditSettings("TEAM_MEMBER")).toBe(false));
  it("denies VIEWER", () => expect(canEditSettings("VIEWER")).toBe(false));
});

describe("canManageMembers — PROJECT_LEAD only", () => {
  it("allows PROJECT_LEAD", () => expect(canManageMembers("PROJECT_LEAD")).toBe(true));
  it("denies TEAM_MEMBER", () => expect(canManageMembers("TEAM_MEMBER")).toBe(false));
  it("denies VIEWER", () => expect(canManageMembers("VIEWER")).toBe(false));
});

describe("canEditIssues — PROJECT_LEAD and TEAM_MEMBER", () => {
  it("allows PROJECT_LEAD", () => expect(canEditIssues("PROJECT_LEAD")).toBe(true));
  it("allows TEAM_MEMBER", () => expect(canEditIssues("TEAM_MEMBER")).toBe(true));
  it("denies VIEWER", () => expect(canEditIssues("VIEWER")).toBe(false));
});

describe("canViewProject — all roles", () => {
  it.each(ALL_ROLES)("allows %s", (role) => expect(canViewProject(role)).toBe(true));
});

describe("canComment — all roles", () => {
  it.each(ALL_ROLES)("allows %s", (role) => expect(canComment(role)).toBe(true));
});

describe("role hierarchy consistency", () => {
  it("PROJECT_LEAD can do everything TEAM_MEMBER can", () => {
    const checks = [canEditSettings, canManageMembers, canEditIssues, canViewProject, canComment];
    for (const check of checks) {
      expect(check("PROJECT_LEAD")).toBe(check("TEAM_MEMBER") || true);
    }
  });

  it("VIEWER cannot edit issues, settings, or members", () => {
    expect(canEditIssues("VIEWER")).toBe(false);
    expect(canEditSettings("VIEWER")).toBe(false);
    expect(canManageMembers("VIEWER")).toBe(false);
    expect(canManageProject("VIEWER")).toBe(false);
  });
});

// ─── Additive RBAC: Group grants boost a role, never replace it (JFR-102) ─────

describe("Group grants boost a VIEWER's project-level permissions", () => {
  it("canManageProject: VIEWER + PROJECT_DELETE grant is allowed, without the grant is denied", () => {
    expect(canManageProject("VIEWER", new Set<Permission>(["PROJECT_DELETE"]))).toBe(true);
    expect(canManageProject("VIEWER", new Set())).toBe(false);
  });

  it("canEditSettings: VIEWER + PROJECT_EDIT_SETTINGS grant is allowed", () => {
    expect(canEditSettings("VIEWER", new Set<Permission>(["PROJECT_EDIT_SETTINGS"]))).toBe(true);
  });

  it("canManageMembers: VIEWER + PROJECT_MANAGE_MEMBERS grant is allowed", () => {
    expect(canManageMembers("VIEWER", new Set<Permission>(["PROJECT_MANAGE_MEMBERS"]))).toBe(true);
  });

  it("canEditIssues: VIEWER + ISSUE_EDIT grant is allowed", () => {
    expect(canEditIssues("VIEWER", new Set<Permission>(["ISSUE_EDIT"]))).toBe(true);
  });

  it("an unrelated grant does not boost a different permission", () => {
    expect(canManageProject("VIEWER", new Set<Permission>(["ISSUE_EDIT"]))).toBe(false);
  });

  it("omitting grants entirely behaves exactly like an empty set (default param)", () => {
    expect(canEditIssues("VIEWER")).toBe(false);
    expect(canManageProject("PROJECT_LEAD")).toBe(true);
  });
});

describe("Group grants boost a MEMBER org role", () => {
  it("canManageCustomFields: MEMBER + ORG_MANAGE_CUSTOM_FIELDS grant is allowed, without is denied", () => {
    expect(canManageCustomFields("MEMBER", new Set<Permission>(["ORG_MANAGE_CUSTOM_FIELDS"]))).toBe(true);
    expect(canManageCustomFields("MEMBER", new Set())).toBe(false);
  });

  it("canManageApiKeys: MEMBER + ORG_MANAGE_API_KEYS grant is allowed", () => {
    expect(canManageApiKeys("MEMBER", new Set<Permission>(["ORG_MANAGE_API_KEYS"]))).toBe(true);
  });
});

describe("canManageGroups — OWNER + ADMIN only, deliberately not boostable", () => {
  it("allows OWNER and ADMIN", () => {
    expect(canManageGroups("OWNER")).toBe(true);
    expect(canManageGroups("ADMIN")).toBe(true);
  });

  it("denies MEMBER (canManageGroups takes no grants parameter at all)", () => {
    expect(canManageGroups("MEMBER")).toBe(false);
  });
});

describe("getUserGrants", () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it("returns a Set built from the matching GroupPermission rows", async () => {
    mockFindMany.mockResolvedValue([{ permission: "ISSUE_EDIT" }, { permission: "PROJECT_DELETE" }]);
    const grants = await getUserGrants("user-1", "org-1", "project-1");
    expect(grants).toEqual(new Set<Permission>(["ISSUE_EDIT", "PROJECT_DELETE"]));
  });

  it("when a projectId is given, queries for that project's grants OR org-wide grants", async () => {
    mockFindMany.mockResolvedValue([]);
    await getUserGrants("user-1", "org-1", "project-1");
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ projectId: "project-1" }, { projectId: null }]);
    expect(where.group).toEqual({ orgId: "org-1", members: { some: { userId: "user-1" } } });
  });

  it("when no projectId is given (org-level check), only queries org-wide grants", async () => {
    mockFindMany.mockResolvedValue([]);
    await getUserGrants("user-1", "org-1");
    const where = mockFindMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ projectId: null }]);
  });
});
