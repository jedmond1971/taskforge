"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { StatusCategory } from "@prisma/client";
import { Plus, ChevronDown, ChevronRight, Inbox } from "lucide-react";
import { KanbanCard } from "./KanbanCard";
import { CreateIssueDialog } from "@/components/issues/CreateIssueDialog";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

const COLUMN_ACCENT: Record<StatusCategory, { top: string; dot: string; well: string }> = {
  TODO: { top: "border-t-border", dot: "bg-muted-foreground", well: "bg-surface" },
  IN_PROGRESS: { top: "border-t-warning", dot: "bg-warning", well: "bg-warning-soft/20" },
  DONE: { top: "border-t-success", dot: "bg-success", well: "bg-success-soft/20" },
};

type BoardStatus = {
  id: string;
  name: string;
  category: StatusCategory;
};

type CardIssue = {
  id: string;
  key: string;
  title: string;
  status: { id: string; name: string; category: StatusCategory };
  priority: import("@prisma/client").IssuePriority;
  type: import("@prisma/client").IssueType;
  dueDate?: Date | null;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
};

interface KanbanColumnProps {
  status: BoardStatus;
  issues: CardIssue[];
  projectKey: string;
  isOver?: boolean;
}

export function KanbanColumn({ status, issues, projectKey, isOver }: KanbanColumnProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const accent = COLUMN_ACCENT[status.category];
  const isDoneColumn = status.category === "DONE";

  const { setNodeRef } = useDroppable({ id: status.id });

  return (
    <div className="flex flex-col flex-shrink-0 w-64 sm:w-72 h-full">
      {/* Column header */}
      <div
        className={cn(
          "bg-surface border-t-2 rounded-t-lg px-3 py-2.5 flex items-center justify-between shadow-[var(--shadow-panel)]",
          accent.top
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isDoneColumn && (
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              aria-label={collapsed ? `Expand ${status.name}` : `Collapse ${status.name}`}
            >
              {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
          <div className={cn("w-2 h-2 rounded-full flex-shrink-0", accent.dot)} />
          <span className="text-sm font-semibold text-foreground truncate">{status.name}</span>
          <span className="text-xs text-muted-foreground bg-surface-active rounded px-1.5 py-0.5 font-mono flex-shrink-0">
            {issues.length}
          </span>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="p-1 text-muted-foreground hover:text-foreground hover:bg-surface-active rounded transition-colors flex-shrink-0"
          aria-label={`Add issue to ${status.name}`}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Card area */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 min-h-0 rounded-b-lg p-2 space-y-2 overflow-y-auto scrollbar-thin transition-colors",
          accent.well,
          isOver && "bg-surface-active"
        )}
      >
        <SortableContext
          items={issues.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {!collapsed &&
            issues.map((issue) => (
              <KanbanCard key={issue.id} issue={issue} projectKey={projectKey} />
            ))}
        </SortableContext>

        {collapsed && issues.length > 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            {issues.length} done issue{issues.length !== 1 ? "s" : ""} hidden
          </p>
        )}

        {!collapsed && issues.length === 0 && (
          <EmptyState
            icon={Inbox}
            title="No issues"
            action={{ label: "Add one", onClick: () => setCreateOpen(true) }}
            className="py-6"
          />
        )}
      </div>

      {/* CreateIssueDialog pre-seeded with this column's status */}
      <CreateIssueDialog
        projectKey={projectKey}
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultStatusId={status.id}
      />
    </div>
  );
}
