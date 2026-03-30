"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { IssueStatus, IssuePriority, IssueType } from "@prisma/client";
import { STATUS_CONFIG, PRIORITY_CONFIG, TYPE_CONFIG } from "@/lib/issue-utils";
import { X } from "lucide-react";

type Member = { id: string; name: string; avatarUrl: string | null };

interface IssueFiltersBarProps {
  members: Member[];
  projectKey: string;
  currentFilters: {
    status?: string;
    priority?: string;
    type?: string;
    assigneeId?: string;
  };
}

export function IssueFiltersBar({ members, currentFilters }: IssueFiltersBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearAll() {
    router.push(pathname);
  }

  const hasFilters = !!(currentFilters.status || currentFilters.priority || currentFilters.type || currentFilters.assigneeId);

  const selectClass = "px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={currentFilters.status ?? ""}
        onChange={(e) => updateFilter("status", e.target.value)}
        className={selectClass}
      >
        <option value="">All Statuses</option>
        {(Object.keys(STATUS_CONFIG) as IssueStatus[]).map((s) => (
          <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
        ))}
      </select>

      <select
        value={currentFilters.priority ?? ""}
        onChange={(e) => updateFilter("priority", e.target.value)}
        className={selectClass}
      >
        <option value="">All Priorities</option>
        {(Object.keys(PRIORITY_CONFIG) as IssuePriority[]).map((p) => (
          <option key={p} value={p}>{PRIORITY_CONFIG[p].label}</option>
        ))}
      </select>

      <select
        value={currentFilters.type ?? ""}
        onChange={(e) => updateFilter("type", e.target.value)}
        className={selectClass}
      >
        <option value="">All Types</option>
        {(Object.keys(TYPE_CONFIG) as IssueType[]).map((t) => (
          <option key={t} value={t}>{TYPE_CONFIG[t].label}</option>
        ))}
      </select>

      <select
        value={currentFilters.assigneeId ?? ""}
        onChange={(e) => updateFilter("assigneeId", e.target.value)}
        className={selectClass}
      >
        <option value="">All Assignees</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>

      {hasFilters && (
        <button
          onClick={clearAll}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-lg hover:bg-zinc-800 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Clear
        </button>
      )}
    </div>
  );
}
