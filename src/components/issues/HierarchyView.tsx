"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusCategory, IssuePriority, IssueType } from "@prisma/client";
import { ChevronRight, ChevronDown, Link2Off, Layers } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { TYPE_CONFIG } from "@/lib/issue-utils";
type HierarchyIssue = {
  id: string;
  key: string;
  title: string;
  projectStatus: { id: string; name: string; category: StatusCategory };
  priority: IssuePriority;
  type: IssueType;
  parentId: string | null;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
};

interface HierarchyViewProps {
  issues: HierarchyIssue[];
  projectKey: string;
}

function buildTree(issues: HierarchyIssue[]) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const childrenOf = new Map<string | null, HierarchyIssue[]>();

  for (const issue of issues) {
    const parentId = issue.parentId && byId.has(issue.parentId) ? issue.parentId : null;
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId)!.push(issue);
  }

  const roots = childrenOf.get(null) ?? [];
  const parents = roots.filter((r) => (childrenOf.get(r.id) ?? []).length > 0);
  const unparented = roots.filter((r) => (childrenOf.get(r.id) ?? []).length === 0);

  return { childrenOf, parents, unparented };
}

function countDescendants(id: string, childrenOf: Map<string | null, HierarchyIssue[]>): number {
  const children = childrenOf.get(id) ?? [];
  return children.reduce((acc, c) => acc + 1 + countDescendants(c.id, childrenOf), 0);
}

function IssueRow({
  issue,
  depth,
  projectKey,
  childrenOf,
  collapsed,
  onToggle,
}: {
  issue: HierarchyIssue;
  depth: number;
  projectKey: string;
  childrenOf: Map<string | null, HierarchyIssue[]>;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
}) {
  const children = childrenOf.get(issue.id) ?? [];
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(issue.id);
  const descendantCount = hasChildren ? countDescendants(issue.id, childrenOf) : 0;

  return (
    <>
      <tr className="border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
        <td className="py-2.5 pr-3" style={{ paddingLeft: `${12 + depth * 20}px` }}>
          <div className="flex items-center gap-1 min-w-0">
            {hasChildren ? (
              <button
                onClick={() => onToggle(issue.id)}
                className="flex-shrink-0 p-0.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                aria-label={isCollapsed ? "Expand" : "Collapse"}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <span className="flex-shrink-0 w-5" />
            )}
            <span className="flex-shrink-0 text-sm mr-1.5" title={TYPE_CONFIG[issue.type].label}>
              {TYPE_CONFIG[issue.type].icon}
            </span>
            <Link
              href={`/projects/${projectKey}/issues/${issue.key}`}
              className="flex-shrink-0 font-mono text-xs text-zinc-400 dark:text-zinc-500 mr-2 hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              {issue.key}
            </Link>
            <Link
              href={`/projects/${projectKey}/issues/${issue.key}`}
              className="text-sm text-zinc-900 dark:text-zinc-100 truncate hover:text-indigo-600 dark:hover:text-indigo-300"
            >
              {issue.title}
            </Link>
            {hasChildren && (
              <span className="flex-shrink-0 ml-1.5 text-xs text-zinc-400 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-full px-1.5 py-px">
                {descendantCount}
              </span>
            )}
          </div>
        </td>
        <td className="py-2.5 px-3 whitespace-nowrap">
          <StatusBadge status={issue.projectStatus} />
        </td>
        <td className="py-2.5 px-3 whitespace-nowrap">
          <PriorityBadge priority={issue.priority} />
        </td>
        <td className="py-2.5 px-3 text-center text-sm" title={TYPE_CONFIG[issue.type].label}>
          {TYPE_CONFIG[issue.type].icon}
        </td>
        <td className="py-2.5 px-3 whitespace-nowrap">
          {issue.assignee ? (
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-full bg-indigo-700 flex items-center justify-center flex-shrink-0">
                <span className="text-xs text-white font-medium">
                  {issue.assignee.name.charAt(0)}
                </span>
              </div>
              <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-[80px]">
                {issue.assignee.name}
              </span>
            </div>
          ) : (
            <span className="text-xs text-zinc-400 dark:text-zinc-600">Unassigned</span>
          )}
        </td>
      </tr>
      {!isCollapsed &&
        children.map((child) => (
          <IssueRow
            key={child.id}
            issue={child}
            depth={depth + 1}
            projectKey={projectKey}
            childrenOf={childrenOf}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}

export function HierarchyView({ issues, projectKey }: HierarchyViewProps) {
  const { childrenOf, parents, unparented } = buildTree(issues);

  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(parents.map((p) => p.id))
  );

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16">
        <Layers className="w-12 h-12 text-zinc-300 dark:text-zinc-700" />
        <p className="text-lg font-medium text-zinc-500">No issues yet</p>
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

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
            <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-500 w-full">Title</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-500 w-28">Status</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-500 w-24">Priority</th>
            <th className="text-center px-3 py-2.5 text-xs font-medium text-zinc-500 w-12">Type</th>
            <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-500 w-28">Assignee</th>
          </tr>
        </thead>
        <tbody>
          {parents.map((issue) => (
            <IssueRow
              key={issue.id}
              issue={issue}
              depth={0}
              projectKey={projectKey}
              childrenOf={childrenOf}
              collapsed={collapsed}
              onToggle={toggle}
            />
          ))}

          {unparented.length > 0 && (
            <>
              <tr className="bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800">
                <td
                  colSpan={5}
                  className="px-3 py-2 text-xs font-medium text-zinc-500 dark:text-zinc-400"
                >
                  <div className="flex items-center gap-1.5">
                    <Link2Off className="w-3.5 h-3.5" />
                    Unparented ({unparented.length})
                  </div>
                </td>
              </tr>
              {unparented.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  depth={0}
                  projectKey={projectKey}
                  childrenOf={childrenOf}
                  collapsed={collapsed}
                  onToggle={toggle}
                />
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
