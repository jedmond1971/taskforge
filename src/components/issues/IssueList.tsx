"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { StatusCategory, IssuePriority, IssueType } from "@prisma/client";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { TYPE_CONFIG } from "@/lib/issue-utils";
import { ChevronUp, ChevronDown, MessageSquare, CheckSquare, AlertCircle, X } from "lucide-react";
import { bulkUpdateIssues } from "@/app/(dashboard)/projects/[projectKey]/actions";

type IssueWithRelations = {
  id: string;
  key: string;
  title: string;
  statusId: string;
  projectStatus: { id: string; name: string; category: StatusCategory };
  priority: IssuePriority;
  type: IssueType;
  dueDate?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
  _count: { comments: number };
};

type ProjectStatus = { id: string; name: string; category: StatusCategory };
type SortField = "key" | "priority" | "createdAt" | "updatedAt" | "dueDate";
type SortOrder = "asc" | "desc";

interface IssueListProps {
  issues: IssueWithRelations[];
  projectKey: string;
  statuses: ProjectStatus[];
}

const priorityWeight: Record<IssuePriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function IssueList({ issues, projectKey, statuses }: IssueListProps) {
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder(field === "priority" ? "asc" : "desc");
    }
  }

  const sorted = [...issues].sort((a, b) => {
    const dir = sortOrder === "asc" ? 1 : -1;
    if (sortField === "priority") {
      return (priorityWeight[a.priority] - priorityWeight[b.priority]) * dir;
    }
    if (sortField === "key") {
      const aNum = parseInt(a.key.split("-")[1] ?? "0", 10);
      const bNum = parseInt(b.key.split("-")[1] ?? "0", 10);
      return (aNum - bNum) * dir;
    }
    if (sortField === "dueDate") {
      const aTime = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bTime = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return (aTime - bTime) * dir;
    }
    return (new Date(a[sortField]).getTime() - new Date(b[sortField]).getTime()) * dir;
  });

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === sorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map((i) => i.id)));
    }
  }

  function handleBulkStatus(statusId: string) {
    startTransition(async () => {
      await bulkUpdateIssues(projectKey, Array.from(selectedIds), statusId);
      setSelectedIds(new Set());
    });
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronUp className="w-3 h-3 text-zinc-400 dark:text-zinc-600" />;
    return sortOrder === "asc"
      ? <ChevronUp className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
      : <ChevronDown className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />;
  }

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <CheckSquare className="w-12 h-12 text-zinc-300 dark:text-zinc-700" />
        <p className="text-lg font-medium text-zinc-500">No issues found</p>
        <p className="text-sm text-zinc-400 dark:text-zinc-600">
          Press{" "}
          <kbd className="px-1.5 py-0.5 text-xs font-mono bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded">
            N
          </kbd>{" "}
          to create your first issue
        </p>
      </div>
    );
  }

  const selectClass =
    "px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer disabled:opacity-50";

  return (
    <div className="space-y-2">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg">
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
            {selectedIds.size} selected
          </span>
          <select
            value=""
            onChange={(e) => { if (e.target.value) handleBulkStatus(e.target.value); }}
            className={selectClass}
            disabled={isPending}
          >
            <option value="">Set Status...</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 border border-zinc-300 dark:border-zinc-700 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      )}
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
            <th className="px-4 py-2.5 w-10">
              <input
                type="checkbox"
                checked={sorted.length > 0 && selectedIds.size === sorted.length}
                onChange={toggleSelectAll}
                className="rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
            </th>
            <th
              className="text-left px-4 py-2.5 text-zinc-500 font-medium cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 w-24"
              onClick={() => handleSort("key")}
            >
              <span className="flex items-center gap-1">Key <SortIcon field="key" /></span>
            </th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium">Title</th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-32">Status</th>
            <th
              className="text-left px-4 py-2.5 text-zinc-500 font-medium cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 w-28"
              onClick={() => handleSort("priority")}
            >
              <span className="flex items-center gap-1">Priority <SortIcon field="priority" /></span>
            </th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-20">Type</th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-32 hidden sm:table-cell">Assignee</th>
            <th
              className="text-left px-4 py-2.5 text-zinc-500 font-medium cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 w-28 hidden md:table-cell"
              onClick={() => handleSort("dueDate")}
            >
              <span className="flex items-center gap-1">Due <SortIcon field="dueDate" /></span>
            </th>
            <th
              className="text-left px-4 py-2.5 text-zinc-500 font-medium cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 w-28 hidden sm:table-cell"
              onClick={() => handleSort("createdAt")}
            >
              <span className="flex items-center gap-1">Created <SortIcon field="createdAt" /></span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((issue, i) => (
            <tr
              key={issue.id}
              className={`border-b border-zinc-100 dark:border-zinc-800/50 transition-colors ${i === sorted.length - 1 ? "border-b-0" : ""} ${selectedIds.has(issue.id) ? "bg-indigo-50/50 dark:bg-indigo-900/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30"}`}
            >
              <td className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={selectedIds.has(issue.id)}
                  onChange={() => toggleSelect(issue.id)}
                  className="rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/projects/${projectKey}/issues/${issue.key}`}
                  className="text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 font-mono text-xs"
                >
                  {issue.key}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/projects/${projectKey}/issues/${issue.key}`}
                  className="text-zinc-900 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium line-clamp-1"
                >
                  {issue.title}
                </Link>
                {issue._count.comments > 0 && (
                  <span className="inline-flex items-center gap-1 ml-2 text-xs text-zinc-500">
                    <MessageSquare className="w-3 h-3" />
                    {issue._count.comments}
                  </span>
                )}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={issue.projectStatus} />
              </td>
              <td className="px-4 py-3">
                <PriorityBadge priority={issue.priority} />
              </td>
              <td className="px-4 py-3">
                <span className="text-base" title={TYPE_CONFIG[issue.type].label}>
                  {TYPE_CONFIG[issue.type].icon}
                </span>
              </td>
              <td className="px-4 py-3 hidden sm:table-cell">
                {issue.assignee ? (
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-indigo-700 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs text-white font-medium">{issue.assignee.name.charAt(0)}</span>
                    </div>
                    <span className="text-zinc-500 dark:text-zinc-400 text-xs truncate max-w-20">{issue.assignee.name}</span>
                  </div>
                ) : (
                  <span className="text-zinc-400 dark:text-zinc-600 text-xs">Unassigned</span>
                )}
              </td>
              <td className="px-4 py-3 text-xs hidden md:table-cell">
                {issue.dueDate ? (() => {
                  const due = new Date(issue.dueDate);
                  const isOverdue = due < new Date() && issue.projectStatus.category !== "DONE";
                  return (
                    <span className={`flex items-center gap-1 ${isOverdue ? "text-red-600 dark:text-red-400 font-medium" : "text-zinc-500"}`}>
                      {isOverdue && <AlertCircle className="w-3 h-3" />}
                      {due.toLocaleDateString()}
                    </span>
                  );
                })() : (
                  <span className="text-zinc-300 dark:text-zinc-700">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-zinc-500 text-xs hidden sm:table-cell">
                {new Date(issue.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
