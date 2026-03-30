"use client";

import React from "react";
import { formatDistanceToNow } from "date-fns";
import { Activity } from "lucide-react";

type ActivityEntry = {
  id: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
  user: { id: string; name: string };
  issue?: { key: string; title: string };
};

function formatAction(entry: ActivityEntry): React.ReactNode {
  if (entry.action === "created") {
    return <span className="text-zinc-500 dark:text-zinc-400">created this issue</span>;
  }
  if (entry.action === "commented") {
    return <span className="text-zinc-500 dark:text-zinc-400">added a comment</span>;
  }
  if (entry.action === "updated" && entry.field) {
    const fieldLabel = entry.field;
    const from = entry.oldValue ?? "–";
    const to = entry.newValue ?? "–";
    return (
      <span className="text-zinc-500 dark:text-zinc-400">
        changed <span className="text-zinc-700 dark:text-zinc-300 font-medium">{fieldLabel}</span>{" "}
        from{" "}
        <span className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-700 dark:text-zinc-300">
          {from}
        </span>{" "}
        to{" "}
        <span className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-700 dark:text-zinc-300">
          {to}
        </span>
      </span>
    );
  }
  return <span className="text-zinc-500 dark:text-zinc-400">{entry.action}</span>;
}

export function ActivityFeed({
  entries,
  showIssue = false,
}: {
  entries: ActivityEntry[];
  showIssue?: boolean;
}) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <Activity className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
        <p className="text-sm text-zinc-400 dark:text-zinc-600">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {entries.map((entry) => {
        const initial = entry.user.name.charAt(0).toUpperCase();
        const timeAgo = formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true });

        return (
          <div key={entry.id} className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-xs text-zinc-700 dark:text-zinc-300 font-medium">{initial}</span>
            </div>
            <div className="flex-1 min-w-0 text-sm">
              <p className="leading-snug">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{entry.user.name}</span>{" "}
                {formatAction(entry)}
                {showIssue && entry.issue && (
                  <>
                    {" "}on{" "}
                    <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400">{entry.issue.key}</span>{" "}
                    <span className="text-zinc-500 truncate">{entry.issue.title}</span>
                  </>
                )}
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-0.5">{timeAgo}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
