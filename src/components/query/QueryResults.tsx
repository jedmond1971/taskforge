"use client";

import Link from "next/link";
import { SearchX } from "lucide-react";
import { IssueStatus, IssuePriority, IssueType } from "@prisma/client";
import { StatusBadge } from "@/components/issues/StatusBadge";
import { PriorityBadge } from "@/components/issues/PriorityBadge";
import { TYPE_CONFIG } from "@/lib/issue-utils";
import { Skeleton } from "@/components/ui/skeleton";

interface QueryIssue {
  id: string;
  key: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  createdAt: Date;
  updatedAt: Date;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
  reporter: { id: string; name: string } | null;
  project: { id: string; key: string; name: string };
  _count: { comments: number };
}

export interface QueryResultData {
  issues: QueryIssue[];
  total: number;
}

interface QueryResultsProps {
  results: QueryResultData | null;
  isLoading: boolean;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-5 w-32" />
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
        <div className="bg-zinc-50 dark:bg-zinc-900/50 px-4 py-2.5">
          <Skeleton className="h-4 w-full" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-4 py-3 border-t border-zinc-200/50 dark:border-zinc-800/50"
          >
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-8" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <SearchX className="w-12 h-12 text-zinc-700 mb-4" />
      <p className="text-zinc-400 text-sm font-medium">
        No issues match your query
      </p>
      <p className="text-zinc-600 text-xs mt-1">
        Try adjusting your search criteria
      </p>
    </div>
  );
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function QueryResults({ results, isLoading }: QueryResultsProps) {
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (!results) {
    return null;
  }

  if (results.issues.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">
        Found{" "}
        <span className="text-zinc-900 dark:text-zinc-100 font-medium">{results.total}</span>{" "}
        {results.total === 1 ? "issue" : "issues"}
      </p>
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-x-auto shadow-sm dark:shadow-none">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
              <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-24">
                Key
              </th>
              <th className="text-left px-4 py-2.5 text-zinc-500 font-medium">
                Title
              </th>
              <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-24">
                Project
              </th>
              <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-28">
                Status
              </th>
              <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-24">
                Priority
              </th>
              <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-20">
                Type
              </th>
              <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-32">
                Assignee
              </th>
              <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-28">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {results.issues.map((issue) => {
              const typeConfig =
                TYPE_CONFIG[issue.type as IssueType] ?? null;
              return (
                <tr
                  key={issue.id}
                  className="border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/projects/${issue.project.key}/issues/${issue.key}`}
                      className="text-zinc-500 hover:text-indigo-400 font-mono text-xs transition-colors"
                    >
                      {issue.key}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/projects/${issue.project.key}/issues/${issue.key}`}
                      className="text-zinc-900 dark:text-zinc-100 hover:text-indigo-400 transition-colors line-clamp-1"
                    >
                      {issue.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-indigo-400 font-mono">
                      {issue.project.key}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={issue.status as IssueStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <PriorityBadge
                      priority={issue.priority as IssuePriority}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {typeConfig && (
                      <span
                        title={typeConfig.label}
                        className="text-base"
                      >
                        {typeConfig.icon}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {issue.assignee ? (
                      <span className="text-zinc-700 dark:text-zinc-300 text-xs">
                        {issue.assignee.name}
                      </span>
                    ) : (
                      <span className="text-zinc-600 text-xs">
                        Unassigned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-zinc-500 text-xs">
                      {formatDate(issue.createdAt)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
