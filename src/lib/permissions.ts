import { ProjectMemberRole } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Role hierarchy: OWNER > ADMIN > MEMBER > VIEWER
export type ProjectRole = ProjectMemberRole;

/** OWNER only — delete project, transfer ownership */
export function canManageProject(role: ProjectRole): boolean {
  return role === "OWNER";
}

/** OWNER + ADMIN — rename, description, manage members */
export function canEditSettings(role: ProjectRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** OWNER + ADMIN — invite, remove, change roles */
export function canManageMembers(role: ProjectRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** OWNER + ADMIN + MEMBER — create, edit, delete issues and comments */
export function canEditIssues(role: ProjectRole): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER";
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
  role: ProjectRole;
}> {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const project = await prisma.project.findUnique({
    where: { key: projectKey.toUpperCase() },
    select: { id: true, key: true },
  });
  if (!project) throw new Error("Project not found");

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
    role: membership.role,
  };
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
