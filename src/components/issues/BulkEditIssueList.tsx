"use client";

import Link from "next/link";
import { StatusCategory, IssuePriority } from "@prisma/client";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { CheckSquare } from "lucide-react";

type IssueRow = {
  id: string;
  key: string;
  title: string;
  projectStatus: { id: string; name: string; category: StatusCategory };
  priority: IssuePriority;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
};

interface BulkEditIssueListProps {
  issues: IssueRow[];
  projectKey: string;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}

export function BulkEditIssueList({ issues, projectKey, selectedIds, onToggle, onToggleAll }: BulkEditIssueListProps) {
  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <CheckSquare className="w-12 h-12 text-zinc-300 dark:text-zinc-700" />
        <p className="text-lg font-medium text-zinc-500">No issues match the current filters</p>
      </div>
    );
  }

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-x-auto">
      <table className="w-full text-sm min-w-[520px]">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
            <th className="px-4 py-2.5 w-10">
              <input
                type="checkbox"
                checked={selectedIds.size === issues.length}
                onChange={onToggleAll}
                className="rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-primary focus:ring-primary cursor-pointer"
              />
            </th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-24">Key</th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium">Title</th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-32">Status</th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-28">Priority</th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-32 hidden sm:table-cell">Assignee</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue, i) => (
            <tr
              key={issue.id}
              className={`border-b border-zinc-100 dark:border-zinc-800/50 transition-colors ${i === issues.length - 1 ? "border-b-0" : ""} ${selectedIds.has(issue.id) ? "bg-primary/5 dark:bg-primary/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30"}`}
            >
              <td className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.has(issue.id)}
                  onChange={() => onToggle(issue.id)}
                  className="rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-primary focus:ring-primary cursor-pointer"
                />
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/projects/${projectKey}/issues/${issue.key}`}
                  className="text-zinc-500 hover:text-primary/80 font-mono text-xs"
                >
                  {issue.key}
                </Link>
              </td>
              <td className="px-4 py-3">
                <span className="text-zinc-900 dark:text-zinc-100 font-medium line-clamp-1">{issue.title}</span>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={issue.projectStatus} />
              </td>
              <td className="px-4 py-3">
                <PriorityBadge priority={issue.priority} />
              </td>
              <td className="px-4 py-3 hidden sm:table-cell">
                {issue.assignee ? (
                  <span className="text-zinc-500 dark:text-zinc-400 text-xs truncate max-w-20">{issue.assignee.name}</span>
                ) : (
                  <span className="text-zinc-400 dark:text-zinc-600 text-xs">Unassigned</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
