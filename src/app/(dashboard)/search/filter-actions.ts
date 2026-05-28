"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function getMyFilters(projectId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  // Verify the user is a member of this project before returning its filters
  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: session.user.id, projectId } },
  });
  if (!member) return [];

  return prisma.savedFilter.findMany({
    where: {
      projectId,
      OR: [{ userId: session.user.id }, { isGlobal: true }],
    },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true } } },
  });
}

export async function saveFilter(
  name: string,
  query: string,
  isGlobal: boolean = false,
  projectId: string
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (isGlobal && session.user.role !== "ADMIN") throw new Error("Forbidden");

  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: session.user.id, projectId } },
  });
  if (!member) throw new Error("Not a member of this project");

  const filter = await prisma.savedFilter.create({
    data: { name, query, userId: session.user.id, projectId, isGlobal },
  });

  revalidatePath("/search");
  return filter;
}

export async function updateFilter(
  filterId: string,
  updates: { name?: string; query?: string; isGlobal?: boolean }
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const filter = await prisma.savedFilter.findUnique({
    where: { id: filterId },
  });
  if (!filter) throw new Error("Filter not found");
  if (filter.userId !== session.user.id) throw new Error("Forbidden");
  if (filter.isGlobal && session.user.role !== "ADMIN") throw new Error("Forbidden");
  if (updates.isGlobal === true && session.user.role !== "ADMIN") throw new Error("Forbidden");

  const updated = await prisma.savedFilter.update({
    where: { id: filterId },
    data: updates,
  });

  revalidatePath("/search");
  return updated;
}

export async function deleteFilter(filterId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const filter = await prisma.savedFilter.findUnique({
    where: { id: filterId },
  });
  if (!filter) throw new Error("Filter not found");
  if (filter.userId !== session.user.id) throw new Error("Forbidden");

  await prisma.savedFilter.delete({ where: { id: filterId } });

  revalidatePath("/search");
  return { success: true };
}
