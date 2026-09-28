"use client";

import Link from "next/link";
import { SearchX } from "lucide-react";
import { StatusCategory, IssuePriority, IssueType } from "@prisma/client";
import { StatusBadge } from "@/components/issues/StatusBadge";
import { PriorityBadge } from "@/components/issues/PriorityBadge";
import { TYPE_CONFIG } from "@/lib/issue-utils";
import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

interface QueryIssue {
  id: string;
  key: string;
  title: string;
  statusId: string;
  projectStatus: { id: string; name: string; category: StatusCategory };
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
      <div className="border border-border-soft rounded-lg overflow-hidden">
        <div className="bg-surface-active px-4 py-2.5">
          <Skeleton className="h-4 w-full" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-4 py-3 border-t border-border-soft"
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
    return (
      <EmptyState
        icon={SearchX}
        title="No issues match your query"
        message="Try adjusting your search criteria."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Found{" "}
        <span className="text-foreground font-medium">{results.total}</span>{" "}
        {results.total === 1 ? "issue" : "issues"}
      </p>
      <div className="border border-border-soft rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
          <thead>
            <tr className="border-b border-border-soft bg-surface-active">
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium w-24">
                Key
              </th>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">
                Title
              </th>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium w-24">
                Project
              </th>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium w-28">
                Status
              </th>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium w-24">
                Priority
              </th>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium w-20">
                Type
              </th>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium w-32">
                Assignee
              </th>
              <th className="text-left px-4 py-2.5 text-muted-foreground font-medium w-28">
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
                  className="border-b border-border-soft hover:bg-surface-active transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/projects/${issue.project.key}/issues/${issue.key}`}
                      className="text-muted-foreground hover:text-primary/80 font-mono text-xs transition-colors"
                    >
                      {issue.key}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/projects/${issue.project.key}/issues/${issue.key}`}
                      className="text-foreground hover:text-primary/80 transition-colors line-clamp-1"
                    >
                      {issue.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-primary font-mono">
                      {issue.project.key}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={issue.projectStatus} />
                  </td>
                  <td className="px-4 py-3">
                    <PriorityBadge
                      priority={issue.priority as IssuePriority}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {typeConfig && (
                      <span title={typeConfig.label}>
                        <IssueTypeIcon type={issue.type as IssueType} />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {issue.assignee ? (
                      <span className="text-foreground text-xs">
                        {issue.assignee.name}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        Unassigned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-muted-foreground text-xs">
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
