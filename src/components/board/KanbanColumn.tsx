"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { IssueStatus } from "@prisma/client";
import { Plus } from "lucide-react";
import { KanbanCard } from "./KanbanCard";
import { CreateIssueDialog } from "@/components/issues/CreateIssueDialog";
import { cn } from "@/lib/utils";

type CardIssue = {
  id: string;
  key: string;
  title: string;
  status: IssueStatus;
  priority: import("@prisma/client").IssuePriority;
  type: import("@prisma/client").IssueType;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
};

const COLUMN_CONFIG: Record<IssueStatus, { label: string; border: string; dot: string }> = {
  TODO:        { label: "To Do",       border: "border-t-zinc-500",    dot: "bg-zinc-500"    },
  IN_PROGRESS: { label: "In Progress", border: "border-t-blue-500",    dot: "bg-blue-500"    },
  IN_REVIEW:   { label: "In Review",   border: "border-t-yellow-500",  dot: "bg-yellow-500"  },
  DONE:        { label: "Done",        border: "border-t-emerald-500", dot: "bg-emerald-500" },
};

interface KanbanColumnProps {
  status: IssueStatus;
  issues: CardIssue[];
  projectKey: string;
  isOver?: boolean;
}

export function KanbanColumn({ status, issues, projectKey, isOver }: KanbanColumnProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const cfg = COLUMN_CONFIG[status];

  const { setNodeRef } = useDroppable({ id: status });

  return (
    <div className="flex flex-col flex-shrink-0 w-72">
      {/* Column header */}
      <div
        className={cn(
          "bg-zinc-900 border border-zinc-800 border-t-2 rounded-t-lg px-3 py-2.5 flex items-center justify-between",
          cfg.border
        )}
      >
        <div className="flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full", cfg.dot)} />
          <span className="text-sm font-semibold text-zinc-200">{cfg.label}</span>
          <span className="text-xs text-zinc-500 bg-zinc-800 rounded px-1.5 py-0.5 font-mono">
            {issues.length}
          </span>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="p-1 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
          aria-label={`Add issue to ${cfg.label}`}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Card area */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 border border-t-0 border-zinc-800 rounded-b-lg p-2 space-y-2 min-h-[120px] overflow-y-auto max-h-[calc(100vh-220px)] transition-colors",
          isOver && "bg-zinc-800/40"
        )}
      >
        <SortableContext
          items={issues.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {issues.map((issue) => (
            <KanbanCard key={issue.id} issue={issue} projectKey={projectKey} />
          ))}
        </SortableContext>

        {issues.length === 0 && (
          <div className="flex flex-col items-center justify-center h-24 gap-2">
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
              <Plus className="w-4 h-4 text-zinc-600" />
            </div>
            <p className="text-xs text-zinc-600">No issues</p>
            <button
              onClick={() => setCreateOpen(true)}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Add one
            </button>
          </div>
        )}
      </div>

      {/* CreateIssueDialog pre-seeded with this column's status */}
      <CreateIssueDialog
        projectKey={projectKey}
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultStatus={status}
      />
    </div>
  );
}
