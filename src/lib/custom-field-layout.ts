import { prisma } from "@/lib/prisma";

// Fields without an explicit per-project layout row sort after any field that
// has been arranged, but keep their relative order (org-wide CustomField.position).
const UNARRANGED_GAP = 100_000;

// Hidden fields (JFR-188) are removed from the project's screen layout; pass
// `includeHidden` only where they must still be listed (the layout settings,
// so they can be re-added).
export async function getOrderedApplicableCustomFields(
  orgId: string,
  projectId: string,
  { includeHidden = false }: { includeHidden?: boolean } = {}
) {
  const [fields, layoutRows] = await Promise.all([
    prisma.customField.findMany({
      where: { orgId },
      include: { projectRestrictions: { select: { projectId: true } } },
      orderBy: { position: "asc" },
    }),
    prisma.projectCustomFieldLayout.findMany({
      where: { projectId },
      select: { customFieldId: true, position: true, hidden: true },
    }),
  ]);

  const layoutByField = new Map(layoutRows.map((l) => [l.customFieldId, l]));

  return fields
    .filter(
      (f) =>
        f.projectRestrictions.length === 0 ||
        f.projectRestrictions.some((r) => r.projectId === projectId)
    )
    .map((f) => ({
      ...f,
      hidden: layoutByField.get(f.id)?.hidden ?? false,
      layoutPosition: layoutByField.get(f.id)?.position ?? f.position + UNARRANGED_GAP,
    }))
    .filter((f) => includeHidden || !f.hidden)
    .sort((a, b) => a.layoutPosition - b.layoutPosition);
}
