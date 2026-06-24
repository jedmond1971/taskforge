"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { StatusCategory } from "@prisma/client";
import { Plus } from "lucide-react";
import { KanbanCard } from "./KanbanCard";
import { CreateIssueDialog } from "@/components/issues/CreateIssueDialog";
import { CATEGORY_COLOR } from "@/lib/issue-utils";
import { cn } from "@/lib/utils";

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
  const cfg = CATEGORY_COLOR[status.category];

  const { setNodeRef } = useDroppable({ id: status.id });

  return (
    <div className="flex flex-col flex-shrink-0 w-64 sm:w-72">
      {/* Column header */}
      <div
        className={cn(
          "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 border-t-2 rounded-t-lg px-3 py-2.5 flex items-center justify-between",
          cfg.borderTop
        )}
      >
        <div className="flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full", cfg.dot)} />
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{status.name}</span>
          <span className="text-xs text-zinc-500 bg-zinc-100 dark:bg-zinc-800 rounded px-1.5 py-0.5 font-mono">
            {issues.length}
          </span>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="p-1 text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors"
          aria-label={`Add issue to ${status.name}`}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Card area */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 border border-t-0 border-zinc-200 dark:border-zinc-800 rounded-b-lg p-2 space-y-2 min-h-[120px] overflow-y-auto max-h-[calc(100vh-220px)] transition-colors",
          isOver && "bg-zinc-100 dark:bg-zinc-800/40"
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
            <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <Plus className="w-4 h-4 text-zinc-400 dark:text-zinc-600" />
            </div>
            <p className="text-xs text-zinc-400 dark:text-zinc-600">No issues</p>
            <button
              onClick={() => setCreateOpen(true)}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors"
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
        defaultStatusId={status.id}
      />
    </div>
  );
}
