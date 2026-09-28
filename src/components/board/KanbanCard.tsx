"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import { StatusCategory, IssuePriority, IssueType } from "@prisma/client";
import { MetaChip } from "@/components/ui/badge";
import { MonoMeta } from "@/components/ui/mono-meta";
import { TYPE_CONFIG } from "@/lib/issue-utils";
import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { cn } from "@/lib/utils";
import { AlertCircle, Calendar } from "lucide-react";

const PRIORITY_LABEL: Record<IssuePriority, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

type CardIssue = {
  id: string;
  key: string;
  title: string;
  status: { id: string; name: string; category: StatusCategory };
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
        "bg-surface rounded-lg p-3 select-none touch-none cursor-grab active:cursor-grabbing shadow-[var(--shadow-panel)]",
        isDragging && "opacity-40 border border-dashed border-border",
        isDragOverlay && "shadow-[var(--shadow-overlay)] rotate-1 cursor-grabbing",
        !isDragging && !isDragOverlay && "hover:shadow-[var(--shadow-overlay)] hover:-translate-y-0.5 transition-all duration-150"
      )}
      onClick={() => router.push(`/projects/${projectKey}/issues/${issue.key}`)}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="leading-none" title={TYPE_CONFIG[issue.type].label}><IssueTypeIcon type={issue.type} /></span>
        <MonoMeta>{issue.key}</MonoMeta>
      </div>

      <p className="text-sm text-foreground leading-snug line-clamp-2 mb-2">
        {issue.title}
      </p>

      <div className="flex items-center justify-between gap-2">
        <MetaChip priority={issue.priority} label={PRIORITY_LABEL[issue.priority]} />

        {issue.assignee && (
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
              <span className="text-xs text-primary-foreground font-medium leading-none">
                {issue.assignee.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <span className="text-xs text-muted-foreground truncate">{issue.assignee.name}</span>
          </div>
        )}
      </div>

      {issue.dueDate && issue.status.category !== "DONE" && (() => {
        const due = new Date(issue.dueDate);
        const now = new Date();
        const isOverdue = due < now;
        const isDueSoon = !isOverdue && (due.getTime() - now.getTime()) < 48 * 60 * 60 * 1000;
        if (!isOverdue && !isDueSoon) return null;
        return (
          <div className={cn(
            "flex items-center gap-1 mt-2 text-xs px-1.5 py-0.5 rounded w-fit",
            isOverdue ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"
          )}>
            {isOverdue ? <AlertCircle className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
            {isOverdue ? "Overdue" : "Due soon"} · {due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </div>
        );
      })()}
    </div>
  );
}
