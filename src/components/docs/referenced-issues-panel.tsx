"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IssueStatus } from "@prisma/client";
import { STATUS_CONFIG } from "@/lib/issue-utils";
import { GitBranch } from "lucide-react";

type LinkedIssue = {
  id: string;
  key: string;
  title: string;
  status: IssueStatus;
};

type LinkEntry = {
  id: string;
  issue: LinkedIssue;
};

interface ReferencedIssuesPanelProps {
  projectKey: string;
  pageId: string;
}

export function ReferencedIssuesPanel({ projectKey, pageId }: ReferencedIssuesPanelProps) {
  const [links, setLinks] = useState<LinkEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/docs/${projectKey}/pages/${pageId}/links`)
      .then((r) => r.json())
      .then((data: { links?: LinkEntry[] }) => {
        if (!cancelled) setLinks(data.links ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectKey, pageId]);

  if (loading || links.length === 0) return null;

  return (
    <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
      <div className="flex items-center gap-1.5 mb-2">
        <GitBranch className="w-3.5 h-3.5 text-zinc-400" />
        <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Referenced by {links.length === 1 ? "1 issue" : `${links.length} issues`}
        </h4>
      </div>
      <div className="space-y-1">
        {links.map(({ id, issue }) => {
          const statusCfg = STATUS_CONFIG[issue.status];
          return (
            <Link
              key={id}
              href={`/projects/${projectKey}/issues/${issue.key}`}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors group"
            >
              <span
                className={`text-xs font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${statusCfg.color} ${statusCfg.bg}`}
              >
                {statusCfg.label}
              </span>
              <span className="font-mono text-xs text-indigo-500 dark:text-indigo-400 shrink-0">
                {issue.key}
              </span>
              <span className="text-sm text-zinc-600 dark:text-zinc-400 truncate group-hover:text-zinc-900 dark:group-hover:text-zinc-100">
                {issue.title}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
