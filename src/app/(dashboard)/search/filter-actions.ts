"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function getMyFilters() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  return prisma.savedFilter.findMany({
    where: {
      OR: [{ userId: session.user.id }, { isGlobal: true }],
    },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, name: true } } },
  });
}

export async function saveFilter(
  name: string,
  query: string,
  isGlobal: boolean = false
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const filter = await prisma.savedFilter.create({
    data: { name, query, userId: session.user.id, isGlobal },
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
