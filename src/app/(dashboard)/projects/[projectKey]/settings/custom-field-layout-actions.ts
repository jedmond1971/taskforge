"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireProjectRole, canManageProject } from "@/lib/permissions";
import { getOrderedApplicableCustomFields } from "@/lib/custom-field-layout";

export async function getProjectFieldLayout(projectKey: string) {
  const { projectId, orgId } = await requireProjectRole(projectKey, canManageProject);

  const fields = await getOrderedApplicableCustomFields(orgId, projectId, { includeHidden: true });

  return fields.map(({ id, name, type, hidden }) => ({ id, name, type, hidden }));
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

  // Reordering never changes visibility: `hidden` is left out of `update`.
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

// JFR-188: remove a field from (or re-add it to) this project's screen layout.
// Only the per-project layout row changes — the org-wide CustomField, its
// project restrictions and any stored issue values are left alone.
export async function setProjectFieldHidden(
  projectKey: string,
  customFieldId: string,
  hidden: boolean
) {
  const { projectId, orgId } = await requireProjectRole(projectKey, canManageProject);

  const field = await prisma.customField.findFirst({
    where: { id: customFieldId, orgId },
    include: { projectRestrictions: { select: { projectId: true } } },
  });
  if (!field) throw new Error("Custom field not found");
  if (
    field.projectRestrictions.length > 0 &&
    !field.projectRestrictions.some((r) => r.projectId === projectId)
  ) {
    throw new Error("Custom field is not applicable to this project");
  }

  const last = await prisma.projectCustomFieldLayout.aggregate({
    where: { projectId },
    _max: { position: true },
  });

  await prisma.projectCustomFieldLayout.upsert({
    where: { projectId_customFieldId: { projectId, customFieldId } },
    // A field with no row yet goes to the end of the arranged fields.
    create: { projectId, customFieldId, hidden, position: (last._max.position ?? -1) + 1 },
    update: { hidden },
  });

  revalidatePath(`/projects/${projectKey}/settings`);
  revalidatePath(`/projects/${projectKey}`, "layout");
  return { success: true };
}
