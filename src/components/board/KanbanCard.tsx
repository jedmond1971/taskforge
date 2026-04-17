"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import { IssueStatus, IssuePriority, IssueType } from "@prisma/client";
import { PriorityBadge } from "@/components/issues/PriorityBadge";
import { cn } from "@/lib/utils";

type CardIssue = {
  id: string;
  key: string;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  type: IssueType;
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
        <span className="text-xs font-mono text-zinc-400 dark:text-zinc-600">{issue.key}</span>
        <PriorityBadge priority={issue.priority} />
      </div>

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
