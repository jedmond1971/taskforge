"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOrgRole, canManageCustomFields } from "@/lib/permissions";
import { CustomFieldType } from "@prisma/client";

export async function getCustomFields(orgId: string) {
  await requireOrgRole(orgId, canManageCustomFields);

  return prisma.customField.findMany({
    where: { orgId },
    include: {
      projectRestrictions: {
        include: {
          project: { select: { id: true, name: true, key: true } },
        },
      },
    },
    orderBy: { position: "asc" },
  });
}

export async function getOrgProjects(orgId: string) {
  await requireOrgRole(orgId, canManageCustomFields);

  return prisma.project.findMany({
    where: { orgId },
    select: { id: true, name: true, key: true },
    orderBy: { name: "asc" },
  });
}

export async function createCustomField(
  orgId: string,
  data: {
    name: string;
    type: CustomFieldType;
    options?: string[];
    restrictedProjectIds?: string[];
  },
  projectKey: string
) {
  await requireOrgRole(orgId, canManageCustomFields);

  const name = data.name.trim();
  if (!name) throw new Error("Field name cannot be empty");

  const existing = await prisma.customField.findUnique({
    where: { orgId_name: { orgId, name } },
  });
  if (existing) throw new Error("A custom field with this name already exists in this organization");

  const isSelectType = data.type === "SELECT" || data.type === "MULTI_SELECT";
  let options: string[] = [];
  if (isSelectType) {
    const rawOptions = data.options ?? [];
    const trimmed = Array.from(new Set(rawOptions.map((o) => o.trim()).filter(Boolean)));
    if (trimmed.length === 0) {
      throw new Error("SELECT and MULTI_SELECT fields must have at least one option");
    }
    options = trimmed;
  }

  const restrictedProjectIds = data.restrictedProjectIds ?? [];
  if (restrictedProjectIds.length > 0) {
    const validProjects = await prisma.project.findMany({
      where: { id: { in: restrictedProjectIds }, orgId },
      select: { id: true },
    });
    if (validProjects.length !== restrictedProjectIds.length) {
      throw new Error("One or more specified projects do not belong to this organization");
    }
  }

  const count = await prisma.customField.count({ where: { orgId } });

  const field = await prisma.customField.create({
    data: {
      orgId,
      name,
      type: data.type,
      options,
      position: count,
      ...(restrictedProjectIds.length > 0
        ? {
            projectRestrictions: {
              create: restrictedProjectIds.map((projectId) => ({ projectId })),
            },
          }
        : {}),
    },
    include: {
      projectRestrictions: {
        include: {
          project: { select: { id: true, name: true, key: true } },
        },
      },
    },
  });

  revalidatePath(`/projects/${projectKey}/settings`);
  return { success: true, field };
}

export async function updateCustomField(
  orgId: string,
  fieldId: string,
  data: {
    name?: string;
    options?: string[];
    restrictedProjectIds?: string[];
  },
  projectKey: string
) {
  await requireOrgRole(orgId, canManageCustomFields);

  const field = await prisma.customField.findFirst({
    where: { id: fieldId, orgId },
  });
  if (!field) throw new Error("Custom field not found");

  const updates: { name?: string; options?: string[] } = {};

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new Error("Field name cannot be empty");

    const conflict = await prisma.customField.findUnique({
      where: { orgId_name: { orgId, name } },
    });
    if (conflict && conflict.id !== fieldId) {
      throw new Error("A custom field with this name already exists in this organization");
    }
    updates.name = name;
  }

  if (data.options !== undefined) {
    const isSelectType = field.type === "SELECT" || field.type === "MULTI_SELECT";
    if (isSelectType) {
      const trimmed = Array.from(new Set(data.options.map((o) => o.trim()).filter(Boolean)));
      if (trimmed.length === 0) {
        throw new Error("SELECT and MULTI_SELECT fields must have at least one option");
      }
      updates.options = trimmed;
    }
  }

  if (data.restrictedProjectIds !== undefined && data.restrictedProjectIds.length > 0) {
    const validProjects = await prisma.project.findMany({
      where: { id: { in: data.restrictedProjectIds }, orgId },
      select: { id: true },
    });
    if (validProjects.length !== data.restrictedProjectIds.length) {
      throw new Error("One or more specified projects do not belong to this organization");
    }
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(updates).length > 0) {
      await tx.customField.update({ where: { id: fieldId }, data: updates });
    }
    if (data.restrictedProjectIds !== undefined) {
      await tx.customFieldProject.deleteMany({ where: { customFieldId: fieldId } });
      if (data.restrictedProjectIds.length > 0) {
        await tx.customFieldProject.createMany({
          data: data.restrictedProjectIds.map((projectId) => ({
            customFieldId: fieldId,
            projectId,
          })),
        });
      }
    }
  });

  revalidatePath(`/projects/${projectKey}/settings`);
  return { success: true };
}

export async function deleteCustomField(
  orgId: string,
  fieldId: string,
  projectKey: string
) {
  await requireOrgRole(orgId, canManageCustomFields);

  const field = await prisma.customField.findFirst({
    where: { id: fieldId, orgId },
  });
  if (!field) throw new Error("Custom field not found");

  await prisma.customField.delete({ where: { id: fieldId } });

  revalidatePath(`/projects/${projectKey}/settings`);
  return { success: true };
}
