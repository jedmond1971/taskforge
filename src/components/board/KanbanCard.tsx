"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import { IssueStatus, IssuePriority, IssueType } from "@prisma/client";
import { GripVertical } from "lucide-react";
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
      className={cn(
        "bg-zinc-900 border border-zinc-800 rounded-lg p-3 group select-none",
        isDragging && "opacity-40 border-dashed",
        isDragOverlay && "shadow-2xl shadow-black/50 rotate-1 border-zinc-700",
        !isDragging && !isDragOverlay && "hover:border-zinc-700 hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5 transition-all duration-150"
      )}
    >
      <div className="flex items-start gap-1.5">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 flex-shrink-0 text-zinc-700 hover:text-zinc-400 cursor-grab active:cursor-grabbing touch-none p-1"
          tabIndex={-1}
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>

        {/* Card content — click to navigate */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => router.push(`/projects/${projectKey}/issues/${issue.key}`)}
        >
          <p className="text-sm text-zinc-100 leading-snug line-clamp-2 mb-2">
            {issue.title}
          </p>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono text-zinc-600">{issue.key}</span>
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
      </div>
    </div>
  );
}
