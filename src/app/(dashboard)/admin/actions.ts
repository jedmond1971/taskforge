"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { UserRole, OrgRole, Plan, ProjectMemberRole } from "@prisma/client";
import { deleteObject } from "@/lib/s3";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Forbidden: Admin access required");
  }
  return { userId: session.user.id };
}

// Get all users with project count
export async function getAdminUsers(search?: string) {
  await requireAdmin();
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  return prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      role: true,
      createdAt: true,
      _count: { select: { projectMembers: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// Create a new user
export async function adminCreateUser(data: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}) {
  await requireAdmin();

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new Error("Email already in use");

  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({
    data: { name: data.name, email: data.email, passwordHash, role: data.role },
    select: { id: true, name: true, email: true, role: true },
  });

  revalidatePath("/admin/users");
  return user;
}

// Update user (name, email, role)
export async function adminUpdateUser(
  userId: string,
  updates: { name?: string; email?: string; role?: UserRole }
) {
  await requireAdmin();

  if (updates.email) {
    const existing = await prisma.user.findFirst({
      where: { email: updates.email, NOT: { id: userId } },
    });
    if (existing) throw new Error("Email already in use");
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updates,
    select: { id: true, name: true, email: true, role: true },
  });

  revalidatePath("/admin/users");
  return user;
}

// Reset any user's password (admin override — no current password required)
export async function adminResetUserPassword(userId: string, newPassword: string) {
  await requireAdmin();

  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  revalidatePath("/admin/users");
  return { success: true };
}

// Add any user to any project (admin override)
// Ensures the user is also an OrgMember of the project's org to maintain invariants.
export async function adminAddUserToProject(
  userId: string,
  projectId: string,
  role: ProjectMemberRole
) {
  await requireAdmin();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { orgId: true },
  });
  if (!project) throw new Error("Project not found");

  const existing = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  if (existing) throw new Error("User is already a member of this project");

  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: project.orgId, userId } },
    create: { orgId: project.orgId, userId, role: "MEMBER" },
    update: {},
  });

  await prisma.projectMember.create({ data: { userId, projectId, role } });

  revalidatePath("/admin/users");
  revalidatePath("/admin/projects");
  return { success: true };
}

// Lightweight project list for admin dropdowns
export async function adminGetProjectsForSelect() {
  await requireAdmin();
  return prisma.project.findMany({
    select: { id: true, name: true, key: true },
    orderBy: { name: "asc" },
  });
}

// Delete user
export async function adminDeleteUser(userId: string) {
  await requireAdmin();
  // Prevent deleting yourself
  const session = await auth();
  if (userId === session?.user?.id) throw new Error("Cannot delete your own account");

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/admin/users");
  return { success: true };
}

// Get all projects with counts
export async function getAdminProjects(search?: string) {
  await requireAdmin();
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { key: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  return prisma.project.findMany({
    where,
    select: {
      id: true,
      name: true,
      key: true,
      isClosed: true,
      createdAt: true,
      _count: { select: { members: true, issues: true } },
      members: {
        where: { role: "PROJECT_LEAD" },
        select: { user: { select: { name: true } } },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ─── Org actions ────────────────────────────────────────────────────────────

export async function getAdminOrgs(search?: string) {
  await requireAdmin();
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { slug: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  return prisma.organization.findMany({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      createdAt: true,
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { members: true, projects: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAdminOrgMembers(orgId: string) {
  await requireAdmin();
  return prisma.orgMember.findMany({
    where: { orgId },
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
    orderBy: { role: "asc" },
  });
}

export async function adminCreateOrg(data: {
  name: string;
  slug: string;
  plan: Plan;
  ownerId: string;
}) {
  await requireAdmin();

  const existing = await prisma.organization.findUnique({ where: { slug: data.slug } });
  if (existing) throw new Error("Slug already in use");

  const org = await prisma.organization.create({
    data: {
      name: data.name,
      slug: data.slug,
      plan: data.plan,
      ownerId: data.ownerId,
      members: { create: { userId: data.ownerId, role: "OWNER" } },
    },
    select: { id: true, name: true, slug: true },
  });

  revalidatePath("/admin/orgs");
  return org;
}

export async function adminAddOrgMember(orgId: string, userId: string, role: OrgRole) {
  await requireAdmin();

  const existing = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  if (existing) throw new Error("User is already a member of this org");

  await prisma.orgMember.create({ data: { orgId, userId, role } });
  revalidatePath("/admin/orgs");
  return { success: true };
}

export async function adminRemoveOrgMember(orgId: string, userId: string) {
  await requireAdmin();

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { ownerId: true } });
  if (org?.ownerId === userId) throw new Error("Cannot remove the org owner");

  const projectCount = await prisma.projectMember.count({
    where: { userId, project: { orgId } },
  });
  if (projectCount > 0) {
    throw new Error(
      `Cannot remove this member — they still belong to ${projectCount} project(s) in this organization. Remove them from those projects first.`
    );
  }

  await prisma.orgMember.delete({ where: { orgId_userId: { orgId, userId } } });
  revalidatePath("/admin/orgs");
  return { success: true };
}

export async function adminDeleteOrg(orgId: string) {
  await requireAdmin();

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, _count: { select: { projects: true } } },
  });
  if (!org) throw new Error("Organization not found");

  if (org._count.projects > 0) {
    throw new Error(
      `Cannot delete "${org.name}" — it still has ${org._count.projects} project(s). Delete or reassign all projects first.`
    );
  }

  await prisma.organization.delete({ where: { id: orgId } });
  revalidatePath("/admin/orgs");
  return { success: true };
}

// ─── Project actions ─────────────────────────────────────────────────────────

// Delete project (admin override - no ownership check needed)
export async function adminDeleteProject(projectId: string) {
  await requireAdmin();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { key: true },
  });
  if (!project) throw new Error("Project not found");

  const attachments = await prisma.attachment.findMany({
    where: { issue: { projectId } },
    select: { fileKey: true },
  });

  const docPages = await prisma.docPage.findMany({
    where: {
      docSpace: { projectId },
      fileKey: { not: null },
    },
    select: { fileKey: true },
  });

  const keysToDelete = [
    ...attachments.map((a) => a.fileKey),
    ...docPages.map((p) => p.fileKey as string),
  ];

  for (const key of keysToDelete) {
    try {
      await deleteObject(key);
    } catch (e) {
      console.error(`Failed to delete S3 object ${key}:`, e);
    }
  }

  await prisma.project.delete({ where: { id: projectId } });
  revalidatePath("/admin/projects");
  return { success: true };
}

// ─── Close / Reopen project ──────────────────────────────────────────────────

export async function closeProject(projectId: string) {
  await requireAdmin();
  await prisma.project.update({ where: { id: projectId }, data: { isClosed: true } });
  revalidatePath('/admin/projects');
}

export async function reopenProject(projectId: string) {
  await requireAdmin();
  await prisma.project.update({ where: { id: projectId }, data: { isClosed: false } });
  revalidatePath('/admin/projects');
}
