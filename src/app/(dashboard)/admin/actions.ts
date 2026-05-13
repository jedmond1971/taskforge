"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { UserRole, OrgRole, Plan } from "@prisma/client";

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

  await prisma.project.delete({ where: { id: projectId } });
  revalidatePath("/admin/projects");
  return { success: true };
}
