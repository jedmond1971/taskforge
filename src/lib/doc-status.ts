import { DocPageStatus } from "@prisma/client";

export const DOC_STATUS_CONFIG: Record<DocPageStatus, { label: string; color: string; bg: string }> = {
  DRAFT: { label: "Draft", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950" },
  IN_REVIEW: { label: "In review", color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950" },
  PUBLISHED: { label: "Published", color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950" },
};
