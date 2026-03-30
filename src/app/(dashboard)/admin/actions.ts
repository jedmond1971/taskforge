"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";

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
        where: { role: "OWNER" },
        select: { user: { select: { name: true } } },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

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
