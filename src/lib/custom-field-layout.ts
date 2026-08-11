import { prisma } from "@/lib/prisma";

// Fields without an explicit per-project layout row sort after any field that
// has been arranged, but keep their relative order (org-wide CustomField.position).
const UNARRANGED_GAP = 100_000;

export async function getOrderedApplicableCustomFields(orgId: string, projectId: string) {
  const [fields, layoutRows] = await Promise.all([
    prisma.customField.findMany({
      where: { orgId },
      include: { projectRestrictions: { select: { projectId: true } } },
      orderBy: { position: "asc" },
    }),
    prisma.projectCustomFieldLayout.findMany({
      where: { projectId },
      select: { customFieldId: true, position: true },
    }),
  ]);

  const layoutByField = new Map(layoutRows.map((l) => [l.customFieldId, l.position]));

  return fields
    .filter(
      (f) =>
        f.projectRestrictions.length === 0 ||
        f.projectRestrictions.some((r) => r.projectId === projectId)
    )
    .map((f) => ({
      ...f,
      layoutPosition: layoutByField.get(f.id) ?? f.position + UNARRANGED_GAP,
    }))
    .sort((a, b) => a.layoutPosition - b.layoutPosition);
}
