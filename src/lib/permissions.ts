import { OrgRole, ProjectMemberRole } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Role hierarchy: PROJECT_LEAD > TEAM_MEMBER > VIEWER
export type ProjectRole = ProjectMemberRole;

/** PROJECT_LEAD only — delete project */
export function canManageProject(role: ProjectRole): boolean {
  return role === "PROJECT_LEAD";
}

/** PROJECT_LEAD only — rename, description, manage members */
export function canEditSettings(role: ProjectRole): boolean {
  return role === "PROJECT_LEAD";
}

/** PROJECT_LEAD only — invite, remove, change roles */
export function canManageMembers(role: ProjectRole): boolean {
  return role === "PROJECT_LEAD";
}

/** PROJECT_LEAD + TEAM_MEMBER — create, edit, delete issues and comments */
export function canEditIssues(role: ProjectRole): boolean {
  return role === "PROJECT_LEAD" || role === "TEAM_MEMBER";
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
  check: (role: ProjectRole) => boolean
): Promise<{
  userId: string;
  projectId: string;
  projectKey: string;
  orgId: string;
  role: ProjectRole;
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const project = await prisma.project.findUnique({
    where: { key: projectKey.toUpperCase() },
    select: { id: true, key: true, orgId: true, isPrivate: true },
  });
  if (!project) throw new Error("Project not found");

  // Private projects are only accessible to explicit members (admins bypass)
  if (project.isPrivate && session.user.role !== "ADMIN") {
    const privacyCheck = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: session.user.id, projectId: project.id } },
      select: { id: true },
    });
    if (!privacyCheck) throw new Error("You do not have access to this project.");
  }

  const membership = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: { userId: session.user.id, projectId: project.id },
    },
    select: { role: true },
  });
  if (!membership) throw new Error("Not a project member");

  if (!check(membership.role)) throw new Error("Forbidden");

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

/** OWNER + ADMIN can manage org-level custom field definitions */
export function canManageCustomFields(role: OrgRoleType): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** OWNER + ADMIN can create and revoke org API keys */
export function canManageApiKeys(role: OrgRoleType): boolean {
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
  check: (role: OrgRoleType) => boolean
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
  if (!membership) throw new Error("Not an organization member");
  if (!check(membership.role)) throw new Error("Forbidden");

  return { userId: session.user.id, orgId, role: membership.role };
}

/**
 * Checks session.user.role === "ADMIN" (UserRole, not ProjectMemberRole).
 * Throws "Unauthorized" if not logged in, "Forbidden" if not an admin.
 */
export async function requireAdmin(): Promise<{ userId: string }> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  if (session.user.role !== "ADMIN") throw new Error("Forbidden");

  return { userId: session.user.id };
}
