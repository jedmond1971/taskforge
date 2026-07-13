"use client";

import { useState, useTransition, useEffect } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getAdminAuditLog } from "../actions";

type AuditEntry = {
  id: string;
  actorId: string | null;
  actorName: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetLabel: string;
  metadata: unknown;
  createdAt: Date;
};

const ACTION_LABELS: Record<string, string> = {
  USER_CREATED: "User Created",
  USER_UPDATED: "User Updated",
  USER_DELETED: "User Deleted",
  PASSWORD_RESET: "Password Reset",
  ROLE_CHANGED: "Role Changed",
  USER_ADDED_TO_PROJECT: "Added to Project",
  ORG_CREATED: "Org Created",
  ORG_DELETED: "Org Deleted",
  ORG_MEMBER_ADDED: "Member Added",
  ORG_MEMBER_REMOVED: "Member Removed",
  PROJECT_DELETED: "Project Deleted",
  PROJECT_CLOSED: "Project Closed",
  PROJECT_REOPENED: "Project Reopened",
  INVITE_CREATED: "Invite Created",
  INVITE_RESENT: "Invite Resent",
  INVITE_REVOKED: "Invite Revoked",
};

const ACTION_COLORS: Record<string, string> = {
  USER_DELETED: "bg-red-600/20 text-red-400 border-red-600/30",
  ORG_DELETED: "bg-red-600/20 text-red-400 border-red-600/30",
  PROJECT_DELETED: "bg-red-600/20 text-red-400 border-red-600/30",
  INVITE_REVOKED: "bg-red-600/20 text-red-400 border-red-600/30",
  USER_CREATED: "bg-green-600/20 text-green-400 border-green-600/30",
  ORG_CREATED: "bg-green-600/20 text-green-400 border-green-600/30",
  INVITE_CREATED: "bg-green-600/20 text-green-400 border-green-600/30",
  PROJECT_CLOSED: "bg-amber-600/20 text-amber-400 border-amber-600/30",
  ROLE_CHANGED: "bg-amber-600/20 text-amber-400 border-amber-600/30",
};

function formatDate(date: Date): string {
  return new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetadataSummary({ action, metadata }: { action: string; metadata: unknown }) {
  if (!metadata || typeof metadata !== "object") return null;
  const m = metadata as Record<string, unknown>;

  if (action === "ROLE_CHANGED" && m.from && m.to) {
    return (
      <span className="text-xs text-zinc-500 font-mono">
        {String(m.from)} → {String(m.to)}
      </span>
    );
  }

  if (action === "USER_ADDED_TO_PROJECT" && m.projectId) {
    return (
      <span className="text-xs text-zinc-500 font-mono">
        role: {String(m.role ?? "?")}
      </span>
    );
  }

  if (action === "ORG_MEMBER_ADDED" && m.role) {
    return (
      <span className="text-xs text-zinc-500 font-mono">role: {String(m.role)}</span>
    );
  }

  const keys = Object.keys(m);
  if (keys.length === 0) return null;

  return (
    <span className="text-xs text-zinc-500 font-mono">
      {keys.map((k) => `${k}: ${String(m[k])}`).join(" · ")}
    </span>
  );
}

export function AdminAuditLogClient({
  initialEntries,
}: {
  initialEntries: AuditEntry[];
}) {
  const [entries, setEntries] = useState<AuditEntry[]>(initialEntries);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      startTransition(async () => {
        try {
          const result = await getAdminAuditLog(search || undefined);
          setEntries(result);
        } catch {
          // ignore search errors
        }
      });
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            placeholder="Search by actor, action, or target..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          />
        </div>
        <p className="text-sm text-zinc-500 ml-auto">
          {entries.length === 200 ? "200+ entries (showing latest 200)" : `${entries.length} entries`}
        </p>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm dark:shadow-none">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                When
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Actor
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Action
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Target
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500 text-sm">
                  No audit log entries found.
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const actionLabel = ACTION_LABELS[entry.action] ?? entry.action;
                const colorClass =
                  ACTION_COLORS[entry.action] ??
                  "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700";

                return (
                  <tr
                    key={entry.id}
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">
                      {formatDate(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-zinc-900 dark:text-zinc-100 leading-tight">
                        {entry.actorName}
                      </div>
                      <div className="text-xs text-zinc-500">{entry.actorEmail}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${colorClass}`}
                      >
                        {actionLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-zinc-900 dark:text-zinc-100 leading-tight">
                        {entry.targetLabel}
                      </div>
                      <div className="text-xs text-zinc-500">{entry.targetType}</div>
                    </td>
                    <td className="px-4 py-3">
                      <MetadataSummary action={entry.action} metadata={entry.metadata} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
