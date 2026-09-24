import { OrgRole, ProjectMemberRole, Permission } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { securityEvent } from "./security-events";
import { currentRequestId } from "./request-context";

export type { Permission };

// Role hierarchy: PROJECT_LEAD > TEAM_MEMBER > VIEWER
export type ProjectRole = ProjectMemberRole;

/**
 * Additive RBAC layer (JFR-102): a Group only ever boosts what a user can do
 * where they're already a ProjectMember/OrgMember — it never grants
 * visibility or membership on its own. Returns the set of Permissions the
 * user holds via any Group they belong to in this org, applicable to
 * `projectId` (or org-wide grants only, if `projectId` is omitted).
 */
export async function getUserGrants(
  userId: string,
  orgId: string,
  projectId?: string
): Promise<Set<Permission>> {
  const rows = await prisma.groupPermission.findMany({
    where: {
      group: { orgId, members: { some: { userId } } },
      OR: projectId ? [{ projectId }, { projectId: null }] : [{ projectId: null }],
    },
    select: { permission: true },
  });
  return new Set(rows.map((r) => r.permission));
}

/** PROJECT_LEAD, or PROJECT_DELETE grant — delete project */
export function canManageProject(role: ProjectRole, grants: Set<Permission> = new Set()): boolean {
  return role === "PROJECT_LEAD" || grants.has("PROJECT_DELETE");
}

/** PROJECT_LEAD, or PROJECT_EDIT_SETTINGS grant — rename, description, manage members */
export function canEditSettings(role: ProjectRole, grants: Set<Permission> = new Set()): boolean {
  return role === "PROJECT_LEAD" || grants.has("PROJECT_EDIT_SETTINGS");
}

/** PROJECT_LEAD, or PROJECT_MANAGE_MEMBERS grant — invite, remove, change roles */
export function canManageMembers(role: ProjectRole, grants: Set<Permission> = new Set()): boolean {
  return role === "PROJECT_LEAD" || grants.has("PROJECT_MANAGE_MEMBERS");
}

/** PROJECT_LEAD + TEAM_MEMBER, or ISSUE_EDIT grant — create, edit, delete issues and comments */
export function canEditIssues(role: ProjectRole, grants: Set<Permission> = new Set()): boolean {
  return role === "PROJECT_LEAD" || role === "TEAM_MEMBER" || grants.has("ISSUE_EDIT");
}

/** PROJECT_LEAD, or SPRINT_MANAGE grant — create, start, and complete sprints */
export function canManageSprint(role: ProjectRole, grants: Set<Permission> = new Set()): boolean {
  return role === "PROJECT_LEAD" || grants.has("SPRINT_MANAGE");
}

/** All roles can view */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function canViewProject(role: ProjectRole): boolean {
  return true;
}

/** All roles can comment */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function canComment(role: ProjectRole): boolean {
  return true;
}

/**
 * Checks the current user's membership in a project and validates their role.
 * Throws "Unauthorized" if not logged in, "Not a project member" if no membership,
 * "Forbidden" if role is insufficient.
 */
export async function requireProjectRole(
  projectKey: string,
  check: (role: ProjectRole, grants: Set<Permission>) => boolean
): Promise<ProjectRoleContext> {
  return resolveProjectRole({ key: projectKey.toUpperCase() }, check);
}

/**
 * Same as requireProjectRole, for callers that only hold the project's cuid
 * (e.g. saved filters). Kept as one code path so private/closed-project and
 * membership enforcement can't drift between the two (SECH-96).
 */
export async function requireProjectRoleById(
  projectId: string,
  check: (role: ProjectRole, grants: Set<Permission>) => boolean
): Promise<ProjectRoleContext> {
  return resolveProjectRole({ id: projectId }, check);
}

type ProjectRoleContext = {
  userId: string;
  projectId: string;
  projectKey: string;
  orgId: string;
  role: ProjectRole;
};

async function resolveProjectRole(
  where: { key: string } | { id: string },
  check: (role: ProjectRole, grants: Set<Permission>) => boolean
): Promise<ProjectRoleContext> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const project = await prisma.project.findUnique({
    where,
    select: { id: true, key: true, orgId: true, isPrivate: true, isClosed: true },
  });
  if (!project) throw new Error("Project not found");

  // Private projects are only accessible to explicit members (admins bypass)
  if (project.isPrivate && session.user.role !== "ADMIN") {
    const privacyCheck = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId: project.id } },
      select: { id: true },
    });
    if (!privacyCheck) {
      securityEvent("authz.denied_private_project", {
        requestId: await currentRequestId(),
        userId: session.user.id,
        orgId: project.orgId,
        meta: { projectId: project.id },
      });
      throw new Error("You do not have access to this project.");
    }
  }

  const membership = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: { userId: session.user.id, projectId: project.id },
    },
    select: { role: true },
  });

  // Closed projects reject writes at the session layer too (the external API
  // and MCP already filter isClosed — SECH-93). Admins bypass, mirroring the
  // closed-project UI gate in [projectKey]/layout.tsx.
  //
  // SECH-114: the membership lookup is hoisted above this check on purpose. A closed
  // project is normal navigation FOR A MEMBER, so that case stays silent — but a
  // non-member reaching one is the same cross-tenant probe we report everywhere else,
  // and short-circuiting here used to hide it (and offered a way to duck a threshold).
  // The thrown error is unchanged either way, so nothing downstream sees a difference.
  if (project.isClosed && session.user.role !== "ADMIN") {
    if (!membership) {
      securityEvent("authz.denied_not_member", {
        requestId: await currentRequestId(),
        userId: session.user.id,
        orgId: project.orgId,
        meta: { projectId: project.id, projectClosed: true },
      });
    }
    throw new Error("This project is closed");
  }
  if (!membership) {
    securityEvent("authz.denied_not_member", {
      requestId: await currentRequestId(),
      userId: session.user.id,
      orgId: project.orgId,
      meta: { projectId: project.id },
    });
    throw new Error("Not a project member");
  }

  const grants = await getUserGrants(session.user.id, project.orgId, project.id);
  if (!check(membership.role, grants)) {
    securityEvent("authz.denied_role", {
      requestId: await currentRequestId(),
      userId: session.user.id,
      orgId: project.orgId,
      meta: { projectId: project.id, role: membership.role },
    });
    throw new Error("Forbidden");
  }

  return {
    userId: session.user.id,
    projectId: project.id,
    projectKey: project.key,
    orgId: project.orgId,
    role: membership.role,
  };
}

// ─── Org-level permissions ────────────────────────────────────────────────────

export type OrgRoleType = OrgRole;

/** OWNER + ADMIN can invite members to the org */
export function canInviteOrgMembers(role: OrgRoleType): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** OWNER + ADMIN, or ORG_MANAGE_CUSTOM_FIELDS grant — manage org-level custom field definitions */
export function canManageCustomFields(role: OrgRoleType, grants: Set<Permission> = new Set()): boolean {
  return role === "OWNER" || role === "ADMIN" || grants.has("ORG_MANAGE_CUSTOM_FIELDS");
}

/** OWNER + ADMIN, or ORG_MANAGE_API_KEYS grant — create and revoke org API keys */
export function canManageApiKeys(role: OrgRoleType, grants: Set<Permission> = new Set()): boolean {
  return role === "OWNER" || role === "ADMIN" || grants.has("ORG_MANAGE_API_KEYS");
}

/**
 * OWNER + ADMIN only — deliberately NOT boostable by a Group grant. Groups
 * themselves are managed only by this check, so a Group can never grant the
 * ability to create/edit more Groups — that would be a self-granting
 * privilege-escalation loop.
 */
export function canManageGroups(role: OrgRoleType): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * Checks the current user's OrgMember role for a given orgId and validates
 * it against `check`. Platform UserRole.ADMIN bypasses the membership
 * requirement entirely (mirrors how requireAdmin() works elsewhere).
 * Throws "Unauthorized" if not logged in, "Not an organization member" if
 * no OrgMember row and not a platform admin, "Forbidden" if role check fails.
 */
export async function requireOrgRole(
  orgId: string,
  check: (role: OrgRoleType, grants: Set<Permission>) => boolean
): Promise<{ userId: string; orgId: string; role: OrgRoleType | "PLATFORM_ADMIN" }> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (session.user.role === "ADMIN") {
    return { userId: session.user.id, orgId, role: "PLATFORM_ADMIN" };
  }

  const membership = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId: session.user.id } },
    select: { role: true },
  });
  if (!membership) {
    securityEvent("authz.denied_not_org_member", {
      requestId: await currentRequestId(),
      userId: session.user.id,
      orgId,
    });
    throw new Error("Not an organization member");
  }

  const grants = await getUserGrants(session.user.id, orgId);
  if (!check(membership.role, grants)) {
    securityEvent("authz.denied_role", {
      requestId: await currentRequestId(),
      userId: session.user.id,
      orgId,
      meta: { role: membership.role },
    });
    throw new Error("Forbidden");
  }

  return { userId: session.user.id, orgId, role: membership.role };
}

/**
 * Checks session.user.role === "ADMIN" (UserRole, not ProjectMemberRole).
 * Throws "Unauthorized" if not logged in, "Forbidden" if not an admin.
 */
export async function requireAdmin(): Promise<{ userId: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (session.user.role !== "ADMIN") {
    securityEvent("authz.denied_admin", {
      requestId: await currentRequestId(),
      userId: session.user.id,
      meta: { role: session.user.role },
    });
    throw new Error("Forbidden");
  }

  return { userId: session.user.id };
}
