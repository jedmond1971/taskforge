"use client";

import { useState } from "react";
import Link from "next/link";
import { IssueStatus, IssuePriority, IssueType } from "@prisma/client";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { TYPE_CONFIG } from "@/lib/issue-utils";
import { ChevronUp, ChevronDown, MessageSquare, CheckSquare } from "lucide-react";

type IssueWithRelations = {
  id: string;
  key: string;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  type: IssueType;
  createdAt: Date;
  updatedAt: Date;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
  _count: { comments: number };
};

type SortField = "key" | "priority" | "createdAt" | "updatedAt";
type SortOrder = "asc" | "desc";

interface IssueListProps {
  issues: IssueWithRelations[];
  projectKey: string;
}

const priorityWeight: Record<IssuePriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function IssueList({ issues, projectKey }: IssueListProps) {
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

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
    return (new Date(a[sortField]).getTime() - new Date(b[sortField]).getTime()) * dir;
  });

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronUp className="w-3 h-3 text-zinc-600" />;
    return sortOrder === "asc"
      ? <ChevronUp className="w-3 h-3 text-indigo-400" />
      : <ChevronDown className="w-3 h-3 text-indigo-400" />;
  }

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <CheckSquare className="w-12 h-12 text-zinc-700" />
        <p className="text-lg font-medium text-zinc-500">No issues found</p>
        <p className="text-sm text-zinc-600">Create your first issue to get started</p>
      </div>
    );
  }

  return (
    <div className="border border-zinc-800 rounded-lg overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50">
            <th
              className="text-left px-4 py-2.5 text-zinc-500 font-medium cursor-pointer hover:text-zinc-300 w-24"
              onClick={() => handleSort("key")}
            >
              <span className="flex items-center gap-1">Key <SortIcon field="key" /></span>
            </th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium">Title</th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-32">Status</th>
            <th
              className="text-left px-4 py-2.5 text-zinc-500 font-medium cursor-pointer hover:text-zinc-300 w-28"
              onClick={() => handleSort("priority")}
            >
              <span className="flex items-center gap-1">Priority <SortIcon field="priority" /></span>
            </th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-20">Type</th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-32 hidden sm:table-cell">Assignee</th>
            <th
              className="text-left px-4 py-2.5 text-zinc-500 font-medium cursor-pointer hover:text-zinc-300 w-28 hidden sm:table-cell"
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
              className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors ${i === sorted.length - 1 ? "border-b-0" : ""}`}
            >
              <td className="px-4 py-3">
                <Link
                  href={`/projects/${projectKey}/issues/${issue.key}`}
                  className="text-zinc-500 hover:text-indigo-400 font-mono text-xs"
                >
                  {issue.key}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/projects/${projectKey}/issues/${issue.key}`}
                  className="text-zinc-100 hover:text-indigo-300 font-medium line-clamp-1"
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
                <StatusBadge status={issue.status} />
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
                    <span className="text-zinc-400 text-xs truncate max-w-20">{issue.assignee.name}</span>
                  </div>
                ) : (
                  <span className="text-zinc-600 text-xs">Unassigned</span>
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
  );
}
