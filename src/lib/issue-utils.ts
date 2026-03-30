import { IssueStatus, IssuePriority, IssueType } from "@prisma/client";

export const STATUS_CONFIG: Record<IssueStatus, { label: string; color: string; bg: string }> = {
  TODO: { label: "To Do", color: "text-zinc-400", bg: "bg-zinc-800" },
  IN_PROGRESS: { label: "In Progress", color: "text-blue-400", bg: "bg-blue-950" },
  IN_REVIEW: { label: "In Review", color: "text-yellow-400", bg: "bg-yellow-950" },
  DONE: { label: "Done", color: "text-emerald-400", bg: "bg-emerald-950" },
};

export const PRIORITY_CONFIG: Record<IssuePriority, { label: string; color: string; bg: string }> = {
  CRITICAL: { label: "Critical", color: "text-red-400", bg: "bg-red-950" },
  HIGH: { label: "High", color: "text-orange-400", bg: "bg-orange-950" },
  MEDIUM: { label: "Medium", color: "text-yellow-400", bg: "bg-yellow-950" },
  LOW: { label: "Low", color: "text-zinc-400", bg: "bg-zinc-800" },
};

export const TYPE_CONFIG: Record<IssueType, { label: string; icon: string }> = {
  BUG: { label: "Bug", icon: "🐛" },
  TASK: { label: "Task", icon: "✓" },
  STORY: { label: "Story", icon: "📖" },
  EPIC: { label: "Epic", icon: "⚡" },
};
