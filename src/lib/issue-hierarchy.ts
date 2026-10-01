import { prisma } from "@/lib/prisma";

const MAX_DEPTH = 50;

// True if making `parentId` the parent of any issue in `childIds` would create a
// cycle: i.e. `parentId` is one of them, or has one of them among its ancestors.
export async function wouldCreateCycle(parentId: string, childIds: string[]): Promise<boolean> {
  const children = new Set(childIds);
  let cursor: string | null = parentId;
  let depth = 0;
  while (cursor && depth < MAX_DEPTH) {
    if (children.has(cursor)) return true;
    const next: { parentId: string | null } | null = await prisma.issue.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = next?.parentId ?? null;
    depth++;
  }
  return false;
}
