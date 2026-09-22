"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireProjectRoleById } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

export async function getMyFilters(projectId: string) {
  const { userId } = await requireProjectRoleById(projectId, () => true);

  return prisma.savedFilter.findMany({
    where: {
      projectId,
      OR: [{ userId }, { isGlobal: true }],
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

  await requireProjectRoleById(projectId, () => true);

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

  // Copy only the editable fields: `updates` is client-controlled at runtime, and
  // passing it through would let a user set userId (planting a filter in someone else's
  // list) or projectId (moving it into another project).
  const data: { name?: string; query?: string; isGlobal?: boolean } = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.query !== undefined) data.query = updates.query;
  if (updates.isGlobal !== undefined) data.isGlobal = updates.isGlobal;

  const updated = await prisma.savedFilter.update({
    where: { id: filterId },
    data,
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
