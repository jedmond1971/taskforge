"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireProjectRole, canManageProject } from "@/lib/permissions";
import { StatusCategory } from "@prisma/client";
import { CATEGORY_ORDER } from "@/lib/issue-utils";

export async function getProjectStatuses(projectKey: string) {
  const { projectId } = await requireProjectRole(projectKey, canManageProject);

  const statuses = await prisma.projectStatus.findMany({
    where: { projectId },
  });

  return statuses.sort((a, b) => {
    const catDiff = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    return catDiff !== 0 ? catDiff : a.position - b.position;
  });
}

export async function createProjectStatus(
  projectKey: string,
  data: { name: string; category: StatusCategory }
) {
  const { projectId } = await requireProjectRole(projectKey, canManageProject);

  const trimmedName = data.name.trim();
  if (!trimmedName) throw new Error("Status name cannot be empty");

  const existing = await prisma.projectStatus.findUnique({
    where: { projectId_name: { projectId, name: trimmedName } },
  });
  if (existing) throw new Error("A status with this name already exists in this project");

  const count = await prisma.projectStatus.count({
    where: { projectId, category: data.category },
  });

  const status = await prisma.projectStatus.create({
    data: {
      projectId,
      name: trimmedName,
      category: data.category,
      position: count,
      isDefault: count === 0,
    },
  });

  revalidatePath(`/projects/${projectKey}/settings`);
  revalidatePath(`/projects/${projectKey}/board`);
  return { success: true, status };
}

export async function renameProjectStatus(
  projectKey: string,
  statusId: string,
  newName: string
) {
  const { projectId } = await requireProjectRole(projectKey, canManageProject);

  const trimmedName = newName.trim();
  if (!trimmedName) throw new Error("Status name cannot be empty");

  const status = await prisma.projectStatus.findFirst({
    where: { id: statusId, projectId },
  });
  if (!status) throw new Error("Status not found");

  const conflict = await prisma.projectStatus.findUnique({
    where: { projectId_name: { projectId, name: trimmedName } },
  });
  if (conflict && conflict.id !== statusId) throw new Error("A status with this name already exists");

  const updated = await prisma.projectStatus.update({
    where: { id: statusId },
    data: { name: trimmedName },
  });

  revalidatePath(`/projects/${projectKey}/settings`);
  revalidatePath(`/projects/${projectKey}/board`);
  return { success: true, status: updated };
}

export async function deleteProjectStatus(projectKey: string, statusId: string) {
  const { projectId } = await requireProjectRole(projectKey, canManageProject);

  await prisma.$transaction(async (tx) => {
    const toDelete = await tx.projectStatus.findFirst({
      where: { id: statusId, projectId },
    });
    if (!toDelete) throw new Error("Status not found");

    const categoryCount = await tx.projectStatus.count({
      where: { projectId, category: toDelete.category },
    });
    if (categoryCount <= 1) {
      throw new Error(
        `Cannot delete the last status in the "${toDelete.category}" category`
      );
    }

    // Find the default for this category (excluding the one being deleted)
    let defaultStatus = await tx.projectStatus.findFirst({
      where: { projectId, category: toDelete.category, isDefault: true, id: { not: statusId } },
    });

    // If the deleted status was the default, promote the first remaining one
    if (!defaultStatus) {
      const first = await tx.projectStatus.findFirst({
        where: { projectId, category: toDelete.category, id: { not: statusId } },
        orderBy: { position: "asc" },
      });
      if (!first) throw new Error("No remaining status found in category");
      await tx.projectStatus.update({ where: { id: first.id }, data: { isDefault: true } });
      defaultStatus = { ...first, isDefault: true };
    }

    // Move all issues in the deleted status to the default
    await tx.issue.updateMany({
      where: { projectId, statusId },
      data: { statusId: defaultStatus.id },
    });

    // Delete the status
    await tx.projectStatus.delete({ where: { id: statusId } });

    // Reindex remaining statuses in this category
    const remaining = await tx.projectStatus.findMany({
      where: { projectId, category: toDelete.category },
      orderBy: { position: "asc" },
    });
    for (let i = 0; i < remaining.length; i++) {
      await tx.projectStatus.update({ where: { id: remaining[i].id }, data: { position: i } });
    }
  });

  revalidatePath(`/projects/${projectKey}/settings`);
  revalidatePath(`/projects/${projectKey}/board`);
  return { success: true };
}

export async function reorderProjectStatuses(
  projectKey: string,
  updates: { id: string; position: number }[]
) {
  const { projectId } = await requireProjectRole(projectKey, canManageProject);

  if (updates.length === 0) return { success: true };

  // Validate all statuses belong to this project and share the same category
  const ids = updates.map((u) => u.id);
  const statuses = await prisma.projectStatus.findMany({
    where: { id: { in: ids }, projectId },
    select: { id: true, category: true },
  });

  if (statuses.length !== updates.length) throw new Error("One or more statuses not found");
  const categories = new Set(statuses.map((s) => s.category));
  if (categories.size > 1) throw new Error("Cannot reorder statuses across categories");

  await prisma.$transaction(
    updates.map((u) =>
      prisma.projectStatus.update({
        where: { id: u.id },
        data: { position: u.position },
      })
    )
  );

  revalidatePath(`/projects/${projectKey}/settings`);
  revalidatePath(`/projects/${projectKey}/board`);
  return { success: true };
}
