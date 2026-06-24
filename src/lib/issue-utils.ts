import { IssuePriority, IssueType, StatusCategory } from "@prisma/client";

export { StatusCategory };

// Fixed display order for status categories on the board
export const CATEGORY_ORDER: Record<StatusCategory, number> = {
  TODO: 0,
  IN_PROGRESS: 1,
  DONE: 2,
};

// Per-category color tokens used by board columns, status badges, and settings UI
export const CATEGORY_COLOR: Record<
  StatusCategory,
  { color: string; bg: string; border: string; borderTop: string; dot: string }
> = {
  TODO: {
    color: "text-zinc-600 dark:text-zinc-400",
    bg: "bg-zinc-100 dark:bg-zinc-800",
    border: "border-zinc-400",
    borderTop: "border-t-zinc-400",
    dot: "bg-zinc-400",
  },
  IN_PROGRESS: {
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-500",
    borderTop: "border-t-blue-500",
    dot: "bg-blue-500",
  },
  DONE: {
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950",
    border: "border-emerald-500",
    borderTop: "border-t-emerald-500",
    dot: "bg-emerald-500",
  },
};

export const PRIORITY_CONFIG: Record<IssuePriority, { label: string; color: string; bg: string }> = {
  CRITICAL: { label: "Critical", color: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-red-950" },
  HIGH: { label: "High", color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950" },
  MEDIUM: { label: "Medium", color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-50 dark:bg-yellow-950" },
  LOW: { label: "Low", color: "text-zinc-600 dark:text-zinc-400", bg: "bg-zinc-100 dark:bg-zinc-800" },
};

export const TYPE_CONFIG: Record<IssueType, { label: string; icon: string }> = {
  BUG: { label: "Bug", icon: "🐛" },
  TASK: { label: "Task", icon: "✓" },
  STORY: { label: "Story", icon: "📖" },
  EPIC: { label: "Epic", icon: "⚡" },
};
