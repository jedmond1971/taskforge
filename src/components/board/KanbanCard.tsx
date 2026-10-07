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
import { AlertCircle, Calendar, ExternalLink } from "lucide-react";

const PRIORITY_LABEL: Record<IssuePriority, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export type QuickUpdate = { priority?: IssuePriority; assigneeId?: string | null };

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
  members?: { id: string; name: string; avatarUrl: string | null }[];
  canEdit?: boolean;
  onQuickUpdate?: (issue: CardIssue, updates: QuickUpdate) => void;
}

const quickSelectClass =
  "min-w-0 flex-1 rounded border border-input bg-transparent px-1 py-0.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function KanbanCard({ issue, projectKey, isDragOverlay = false, members = [], canEdit = false, onQuickUpdate }: KanbanCardProps) {
  const router = useRouter();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id, data: { issue } });

  const showQuickActions = canEdit && !!onQuickUpdate && !isDragOverlay;
  const label = [
    `${issue.key}: ${issue.title}`,
    `status ${issue.status.name}`,
    `priority ${PRIORITY_LABEL[issue.priority]}`,
    issue.assignee ? `assigned to ${issue.assignee.name}` : "unassigned",
  ].join(", ");
  const openIssue = () => router.push(`/projects/${projectKey}/issues/${issue.key}`);
  // Keep pointer/click events inside the quick-actions bar from starting a drag or opening the issue.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

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
      aria-label={label}
      aria-roledescription="draggable issue"
      className={cn(
        "group bg-surface rounded-lg p-3 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch-none cursor-grab active:cursor-grabbing shadow-[var(--shadow-panel)]",
        isDragging && "opacity-40 border border-dashed border-border",
        isDragOverlay && "shadow-[var(--shadow-overlay)] rotate-1 cursor-grabbing",
        !isDragging && !isDragOverlay && "hover:shadow-[var(--shadow-overlay)] hover:-translate-y-0.5 transition-all duration-150"
      )}
      onClick={openIssue}
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

      {showQuickActions && (
        <div
          className="mt-2 hidden items-center gap-1.5 group-hover:flex group-focus-within:flex [@media(hover:none)]:flex"
          onPointerDown={stop}
          onKeyDown={stop}
          onClick={stop}
        >
          <select
            aria-label={`Priority for ${issue.key}`}
            className={quickSelectClass}
            value={issue.priority}
            onChange={(e) => onQuickUpdate!(issue, { priority: e.target.value as IssuePriority })}
          >
            {(Object.keys(PRIORITY_LABEL) as IssuePriority[]).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
          <select
            aria-label={`Assignee for ${issue.key}`}
            className={quickSelectClass}
            value={issue.assignee?.id ?? ""}
            onChange={(e) => onQuickUpdate!(issue, { assigneeId: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`Open ${issue.key}`}
            title={`Open ${issue.key}`}
            onClick={(e) => { e.stopPropagation(); openIssue(); }}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
