"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireProjectRole, canEditIssues } from "@/lib/permissions";

async function logActivity(params: {
  issueId: string;
  userId: string;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
}) {
  await prisma.activityLog.create({ data: params });
}

export async function getApplicableCustomFields(projectKey: string) {
  const { projectId, orgId } = await requireProjectRole(projectKey, () => true);

  const fields = await prisma.customField.findMany({
    where: { orgId },
    include: { projectRestrictions: { select: { projectId: true } } },
    orderBy: { position: "asc" },
  });

  return fields
    .filter(
      (f) =>
        f.projectRestrictions.length === 0 ||
        f.projectRestrictions.some((r) => r.projectId === projectId)
    )
    .map(({ id, name, type, options, position }) => ({ id, name, type, options, position }));
}

export async function getCustomFieldValues(
  projectKey: string,
  issueId: string
): Promise<Record<string, string | number | boolean | string[]>> {
  const { projectId } = await requireProjectRole(projectKey, () => true);

  const issue = await prisma.issue.findFirst({
    where: { id: issueId, projectId },
    select: { id: true },
  });
  if (!issue) throw new Error("Issue not found");

  const values = await prisma.customFieldValue.findMany({ where: { issueId } });

  const map: Record<string, string | number | boolean | string[]> = {};
  for (const v of values) {
    if (v.textValue !== null) map[v.customFieldId] = v.textValue;
    else if (v.numberValue !== null) map[v.customFieldId] = v.numberValue;
    else if (v.dateValue !== null) map[v.customFieldId] = v.dateValue.toISOString();
    else if (v.boolValue !== null) map[v.customFieldId] = v.boolValue;
    else if (v.selectValue !== null) map[v.customFieldId] = v.selectValue;
    else if (v.multiValues.length > 0) map[v.customFieldId] = v.multiValues;
  }

  return map;
}

export async function setCustomFieldValue(
  projectKey: string,
  issueId: string,
  customFieldId: string,
  value: string | number | boolean | string[] | null
): Promise<{ success: boolean }> {
  const { userId, projectId, orgId } = await requireProjectRole(projectKey, canEditIssues);

  const issue = await prisma.issue.findFirst({
    where: { id: issueId, projectId },
    select: { id: true, key: true },
  });
  if (!issue) throw new Error("Issue not found");

  const customField = await prisma.customField.findUnique({
    where: { id: customFieldId },
    include: { projectRestrictions: { select: { projectId: true } } },
  });
  if (!customField) throw new Error("Custom field not found");
  if (customField.orgId !== orgId)
    throw new Error("Custom field does not belong to this organization");
  if (
    customField.projectRestrictions.length > 0 &&
    !customField.projectRestrictions.some((r) => r.projectId === projectId)
  ) {
    throw new Error("Custom field is not applicable to this project");
  }

  const isClearing =
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);

  if (isClearing) {
    await prisma.customFieldValue.deleteMany({ where: { customFieldId, issueId } });
    revalidatePath(`/projects/${projectKey}/issues/${issue.key}`);
    return { success: true };
  }

  type ValueData = {
    textValue: string | null;
    numberValue: number | null;
    dateValue: Date | null;
    boolValue: boolean | null;
    selectValue: string | null;
    multiValues: string[];
  };

  let data: ValueData;
  let coercedValue: string | number | boolean | string[];

  switch (customField.type) {
    case "TEXT": {
      if (typeof value !== "string") throw new Error("TEXT field requires a string value");
      const trimmed = value.trim().slice(0, 500);
      data = { textValue: trimmed, numberValue: null, dateValue: null, boolValue: null, selectValue: null, multiValues: [] };
      coercedValue = trimmed;
      break;
    }
    case "NUMBER": {
      const num = Number(value);
      if (!isFinite(num)) throw new Error("NUMBER field requires a finite numeric value");
      data = { textValue: null, numberValue: num, dateValue: null, boolValue: null, selectValue: null, multiValues: [] };
      coercedValue = num;
      break;
    }
    case "DATE": {
      const d = new Date(value as string);
      if (isNaN(d.getTime())) throw new Error("DATE field requires a valid date value");
      data = { textValue: null, numberValue: null, dateValue: d, boolValue: null, selectValue: null, multiValues: [] };
      coercedValue = d.toISOString();
      break;
    }
    case "CHECKBOX": {
      if (typeof value !== "boolean") throw new Error("CHECKBOX field requires a boolean value");
      data = { textValue: null, numberValue: null, dateValue: null, boolValue: value, selectValue: null, multiValues: [] };
      coercedValue = value;
      break;
    }
    case "SELECT": {
      if (typeof value !== "string") throw new Error("SELECT field requires a string value");
      if (!customField.options.includes(value))
        throw new Error(`"${value}" is not a valid option for this field`);
      data = { textValue: null, numberValue: null, dateValue: null, boolValue: null, selectValue: value, multiValues: [] };
      coercedValue = value;
      break;
    }
    case "MULTI_SELECT": {
      if (!Array.isArray(value)) throw new Error("MULTI_SELECT field requires an array value");
      const invalid = value.find((v) => !customField.options.includes(v));
      if (invalid) throw new Error(`"${invalid}" is not a valid option for this field`);
      const deduped = Array.from(new Set(value));
      data = { textValue: null, numberValue: null, dateValue: null, boolValue: null, selectValue: null, multiValues: deduped };
      coercedValue = deduped;
      break;
    }
    default:
      throw new Error("Unknown field type");
  }

  const existing = await prisma.customFieldValue.findUnique({
    where: { customFieldId_issueId: { customFieldId, issueId } },
  });

  await prisma.customFieldValue.upsert({
    where: { customFieldId_issueId: { customFieldId, issueId } },
    update: data,
    create: { customFieldId, issueId, ...data },
  });

  let oldValue = "";
  if (existing) {
    if (existing.textValue !== null) oldValue = existing.textValue;
    else if (existing.numberValue !== null) oldValue = String(existing.numberValue);
    else if (existing.dateValue !== null) oldValue = existing.dateValue.toISOString();
    else if (existing.boolValue !== null) oldValue = String(existing.boolValue);
    else if (existing.selectValue !== null) oldValue = existing.selectValue;
    else oldValue = existing.multiValues.join(", ");
  }
  const newValue = Array.isArray(coercedValue)
    ? coercedValue.join(", ")
    : String(coercedValue);

  if (oldValue !== newValue) {
    await logActivity({
      issueId,
      userId,
      action: "updated",
      field: `Custom Field: ${customField.name}`,
      oldValue,
      newValue,
    });
  }

  revalidatePath(`/projects/${projectKey}/issues/${issue.key}`);
  return { success: true };
}
