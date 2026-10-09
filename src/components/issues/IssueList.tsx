"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { StatusCategory, IssuePriority, IssueType } from "@prisma/client";
import { StatusBadge } from "./StatusBadge";
import { PriorityBadge } from "./PriorityBadge";
import { TYPE_CONFIG, MAX_BULK_ISSUES } from "@/lib/issue-utils";
import { BulkActionBar, type BulkStatus, type BulkMember, type BulkSprint } from "./BulkActionBar";
import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { ChevronUp, ChevronDown, MessageSquare, CheckSquare, AlertCircle } from "lucide-react";

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

type SortField = "key" | "priority" | "createdAt" | "updatedAt" | "dueDate";
type SortOrder = "asc" | "desc";

interface IssueListProps {
  issues: IssueWithRelations[];
  projectKey: string;
  // Passed only when the viewer may edit issues; omitted → no checkboxes, no action bar.
  bulk?: { statuses: BulkStatus[]; members: BulkMember[]; sprints?: BulkSprint[] };
}

const priorityWeight: Record<IssuePriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

function SortIcon({ field, sortField, sortOrder }: { field: SortField; sortField: SortField; sortOrder: SortOrder }) {
  if (sortField !== field) return <ChevronUp className="w-3 h-3 text-zinc-400 dark:text-zinc-600" />;
  return sortOrder === "asc"
    ? <ChevronUp className="w-3 h-3 text-primary" />
    : <ChevronDown className="w-3 h-3 text-primary" />;
}

export function IssueList({ issues, projectKey, bulk }: IssueListProps) {
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Index (in the sorted view) of the last checkbox clicked — the anchor for shift-click ranges.
  const anchorIndex = useRef<number | null>(null);

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

  // Drop ids that left the list (filtered out or deleted after a refresh) so counts stay honest.
  const liveIds = new Set(sorted.map((i) => i.id));
  const selectedIds = sorted.filter((i) => selected.has(i.id)).map((i) => i.id);
  const allSelected = sorted.length > 0 && selectedIds.length === Math.min(sorted.length, MAX_BULK_ISSUES);

  function capNotice() {
    toast.warning(`Selection is limited to ${MAX_BULK_ISSUES} issues`);
  }

  function handleSelect(index: number, checked: boolean, shiftKey: boolean) {
    const next = new Set(Array.from(selected).filter((id) => liveIds.has(id)));
    const anchor = anchorIndex.current;
    const range =
      shiftKey && anchor !== null
        ? sorted.slice(Math.min(anchor, index), Math.max(anchor, index) + 1)
        : [sorted[index]];

    let capped = false;
    for (const issue of range) {
      if (!checked) next.delete(issue.id);
      else if (next.size < MAX_BULK_ISSUES) next.add(issue.id);
      else capped = true;
    }
    if (capped) capNotice();
    anchorIndex.current = index;
    setSelected(next);
  }

  function handleSelectAll() {
    anchorIndex.current = null;
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(sorted.slice(0, MAX_BULK_ISSUES).map((i) => i.id)));
    if (sorted.length > MAX_BULK_ISSUES) capNotice();
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

  return (
    <div className="space-y-2">
      <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
            {bulk && (
              <th className="px-4 py-2.5 w-10">
                <input
                  type="checkbox"
                  aria-label="Select all issues"
                  checked={allSelected}
                  onChange={handleSelectAll}
                  className="rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-primary focus:ring-primary cursor-pointer"
                />
              </th>
            )}
            <th
              className="text-left px-4 py-2.5 text-zinc-500 font-medium cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 w-24"
              onClick={() => handleSort("key")}
            >
              <span className="flex items-center gap-1">Key <SortIcon field="key" sortField={sortField} sortOrder={sortOrder} /></span>
            </th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium">Title</th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-32">Status</th>
            <th
              className="text-left px-4 py-2.5 text-zinc-500 font-medium cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 w-28"
              onClick={() => handleSort("priority")}
            >
              <span className="flex items-center gap-1">Priority <SortIcon field="priority" sortField={sortField} sortOrder={sortOrder} /></span>
            </th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-20">Type</th>
            <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-32 hidden sm:table-cell">Assignee</th>
            <th
              className="text-left px-4 py-2.5 text-zinc-500 font-medium cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 w-28 hidden md:table-cell"
              onClick={() => handleSort("dueDate")}
            >
              <span className="flex items-center gap-1">Due <SortIcon field="dueDate" sortField={sortField} sortOrder={sortOrder} /></span>
            </th>
            <th
              className="text-left px-4 py-2.5 text-zinc-500 font-medium cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 w-28 hidden sm:table-cell"
              onClick={() => handleSort("createdAt")}
            >
              <span className="flex items-center gap-1">Created <SortIcon field="createdAt" sortField={sortField} sortOrder={sortOrder} /></span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((issue, i) => (
            <tr
              key={issue.id}
              className={`border-b border-zinc-100 dark:border-zinc-800/50 transition-colors ${i === sorted.length - 1 ? "border-b-0" : ""} ${selected.has(issue.id) ? "bg-primary/5 dark:bg-primary/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30"}`}
            >
              {bulk && (
                <td className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    aria-label={`Select ${issue.key}`}
                    checked={selected.has(issue.id)}
                    onChange={(e) =>
                      handleSelect(i, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey === true)
                    }
                    className="rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-primary focus:ring-primary cursor-pointer"
                  />
                </td>
              )}
              <td className="px-4 py-3">
                <Link
                  href={`/projects/${projectKey}/issues/${issue.key}`}
                  className="text-zinc-500 hover:text-primary/80 font-mono text-xs"
                >
                  {issue.key}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/projects/${projectKey}/issues/${issue.key}`}
                  className="text-zinc-900 dark:text-zinc-100 hover:text-primary/80 font-medium line-clamp-1"
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
                <span title={TYPE_CONFIG[issue.type].label}>
                  <IssueTypeIcon type={issue.type} />
                </span>
              </td>
              <td className="px-4 py-3 hidden sm:table-cell">
                {issue.assignee ? (
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <span className="text-xs text-primary-foreground font-medium">{issue.assignee.name.charAt(0)}</span>
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
      {bulk && selectedIds.length > 0 && (
        <BulkActionBar
          projectKey={projectKey}
          selectedIds={selectedIds}
          statuses={bulk.statuses}
          members={bulk.members}
          sprints={bulk.sprints}
          onClear={() => {
            anchorIndex.current = null;
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}
