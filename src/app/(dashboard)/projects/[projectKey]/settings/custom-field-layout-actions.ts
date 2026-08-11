"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireProjectRole, canManageProject } from "@/lib/permissions";
import { getOrderedApplicableCustomFields } from "@/lib/custom-field-layout";

export async function getProjectFieldLayout(projectKey: string) {
  const { projectId, orgId } = await requireProjectRole(projectKey, canManageProject);

  const fields = await getOrderedApplicableCustomFields(orgId, projectId);

  return fields.map(({ id, name, type }) => ({ id, name, type }));
}

export async function reorderProjectFieldLayout(
  projectKey: string,
  updates: { customFieldId: string; position: number }[]
) {
  const { projectId, orgId } = await requireProjectRole(projectKey, canManageProject);

  if (updates.length === 0) return { success: true };

  const ids = updates.map((u) => u.customFieldId);
  const fields = await prisma.customField.findMany({
    where: { id: { in: ids }, orgId },
    include: { projectRestrictions: { select: { projectId: true } } },
  });
  if (fields.length !== updates.length) throw new Error("One or more custom fields not found");

  const inapplicable = fields.find(
    (f) =>
      f.projectRestrictions.length > 0 &&
      !f.projectRestrictions.some((r) => r.projectId === projectId)
  );
  if (inapplicable) throw new Error("Custom field is not applicable to this project");

  await prisma.$transaction(
    updates.map((u) =>
      prisma.projectCustomFieldLayout.upsert({
        where: { projectId_customFieldId: { projectId, customFieldId: u.customFieldId } },
        create: { projectId, customFieldId: u.customFieldId, position: u.position },
        update: { position: u.position },
      })
    )
  );

  revalidatePath(`/projects/${projectKey}/settings`);
  return { success: true };
}
