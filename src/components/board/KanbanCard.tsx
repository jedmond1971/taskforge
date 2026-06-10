"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import { IssueStatus, IssuePriority, IssueType } from "@prisma/client";
import { PriorityBadge } from "@/components/issues/PriorityBadge";
import { TYPE_CONFIG } from "@/lib/issue-utils";
import { cn } from "@/lib/utils";
import { AlertCircle, Calendar } from "lucide-react";

type CardIssue = {
  id: string;
  key: string;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  type: IssueType;
  dueDate?: Date | null;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
};

interface KanbanCardProps {
  issue: CardIssue;
  projectKey: string;
  isDragOverlay?: boolean;
}

export function KanbanCard({ issue, projectKey, isDragOverlay = false }: KanbanCardProps) {
  const router = useRouter();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id, data: { issue } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 select-none touch-none cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40 border-dashed",
        isDragOverlay && "shadow-2xl shadow-black/50 rotate-1 border-zinc-300 dark:border-zinc-700 cursor-grabbing",
        !isDragging && !isDragOverlay && "hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-lg hover:shadow-black/10 dark:hover:shadow-black/20 hover:-translate-y-0.5 transition-all duration-150"
      )}
      onClick={() => router.push(`/projects/${projectKey}/issues/${issue.key}`)}
    >
      <p className="text-sm text-zinc-900 dark:text-zinc-100 leading-snug line-clamp-2 mb-2">
        {issue.title}
      </p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm leading-none" title={TYPE_CONFIG[issue.type].label}>{TYPE_CONFIG[issue.type].icon}</span>
          <span className="text-xs font-mono text-zinc-400 dark:text-zinc-600">{issue.key}</span>
        </div>
        <PriorityBadge priority={issue.priority} />
      </div>

      {issue.dueDate && issue.status !== "DONE" && (() => {
        const due = new Date(issue.dueDate);
        const now = new Date();
        const isOverdue = due < now;
        const isDueSoon = !isOverdue && (due.getTime() - now.getTime()) < 48 * 60 * 60 * 1000;
        if (!isOverdue && !isDueSoon) return null;
        return (
          <div className={cn(
            "flex items-center gap-1 mt-2 text-xs px-1.5 py-0.5 rounded w-fit",
            isOverdue
              ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
              : "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
          )}>
            {isOverdue ? <AlertCircle className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
            {isOverdue ? "Overdue" : "Due soon"} · {due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </div>
        );
      })()}

      {issue.assignee && (
        <div className="flex items-center gap-1.5 mt-2">
          <div className="w-5 h-5 rounded-full bg-indigo-700 flex items-center justify-center flex-shrink-0">
            <span className="text-xs text-white font-medium leading-none">
              {issue.assignee.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <span className="text-xs text-zinc-500 truncate">{issue.assignee.name}</span>
        </div>
      )}
    </div>
  );
}
