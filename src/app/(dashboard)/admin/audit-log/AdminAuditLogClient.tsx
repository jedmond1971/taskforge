"use client";

import { useState, useTransition, useEffect } from "react";
import { Search, ScrollText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
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
  USER_DELETED: "bg-danger-soft text-danger border-danger/20",
  ORG_DELETED: "bg-danger-soft text-danger border-danger/20",
  PROJECT_DELETED: "bg-danger-soft text-danger border-danger/20",
  INVITE_REVOKED: "bg-danger-soft text-danger border-danger/20",
  USER_CREATED: "bg-success-soft text-success border-success/20",
  ORG_CREATED: "bg-success-soft text-success border-success/20",
  INVITE_CREATED: "bg-success-soft text-success border-success/20",
  PROJECT_CLOSED: "bg-warning-soft text-warning border-warning/20",
  ROLE_CHANGED: "bg-warning-soft text-warning border-warning/20",
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
      <span className="font-mono text-xs text-muted-foreground">
        {String(m.from)} → {String(m.to)}
      </span>
    );
  }

  if (action === "USER_ADDED_TO_PROJECT" && m.projectId) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        role: {String(m.role ?? "?")}
      </span>
    );
  }

  if (action === "ORG_MEMBER_ADDED" && m.role) {
    return (
      <span className="font-mono text-xs text-muted-foreground">role: {String(m.role)}</span>
    );
  }

  const keys = Object.keys(m);
  if (keys.length === 0) return null;

  return (
    <span className="font-mono text-xs text-muted-foreground">
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by actor, action, or target..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <p className="text-sm text-muted-foreground ml-auto">
          {entries.length === 200 ? "200+ entries (showing latest 200)" : `${entries.length} entries`}
        </p>
      </div>

      {/* Table */}
      <div className="bg-surface shadow-[var(--shadow-panel)] rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-soft">
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                When
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Actor
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Action
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Target
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState icon={ScrollText} title="No audit log entries found." />
                </td>
              </tr>
            ) : (
              entries.map((entry) => {
                const actionLabel = ACTION_LABELS[entry.action] ?? entry.action;
                const colorClass =
                  ACTION_COLORS[entry.action] ??
                  "bg-surface-active text-muted-foreground border-border-soft";

                return (
                  <tr
                    key={entry.id}
                    className="hover:bg-surface-active transition-colors"
                  >
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-foreground leading-tight">
                        {entry.actorName}
                      </div>
                      <div className="text-xs text-muted-foreground">{entry.actorEmail}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${colorClass}`}
                      >
                        {actionLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-foreground leading-tight">
                        {entry.targetLabel}
                      </div>
                      <div className="text-xs text-muted-foreground">{entry.targetType}</div>
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
