"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X } from "lucide-react";
import { StatusCategory, IssuePriority } from "@prisma/client";
import { PRIORITY_CONFIG } from "@/lib/issue-utils";
import { LabelInput } from "@/components/issues/LabelInput";
import { Button } from "@/components/ui/button";
import { bulkUpdateIssueFields, type BulkIssueUpdates } from "@/app/(dashboard)/projects/[projectKey]/actions";

export type BulkStatus = { id: string; name: string; category: StatusCategory };
export type BulkMember = { id: string; name: string; avatarUrl: string | null };
export type BulkSprint = { id: string; name: string; status: "PLANNED" | "ACTIVE" };

interface BulkActionBarProps {
  projectKey: string;
  selectedIds: string[];
  statuses: BulkStatus[];
  members: BulkMember[];
  // Present only on Sprint-mode projects.
  sprints?: BulkSprint[];
  onClear: () => void;
}

const selectClass =
  "h-8 px-2 rounded-md border border-input bg-transparent text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

const UNASSIGNED = "__unassigned__";
const BACKLOG = "__backlog__";

export function BulkActionBar({ projectKey, selectedIds, statuses, members, sprints, onClear }: BulkActionBarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [labels, setLabels] = useState<string[]>([]);

  function apply(updates: BulkIssueUpdates, summary: string) {
    startTransition(async () => {
      try {
        const result = await bulkUpdateIssueFields(projectKey, selectedIds, updates);
        const n = result.count;
        toast.success(n === 0 ? "No changes — already up to date" : `${summary} on ${n} issue${n !== 1 ? "s" : ""}`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Bulk update failed");
      }
    });
  }

  function applyLabels(mode: "add" | "remove") {
    if (labels.length === 0) return;
    const verb = mode === "add" ? "Added" : "Removed";
    apply(mode === "add" ? { addLabels: labels } : { removeLabels: labels }, `${verb} ${labels.length === 1 ? "label" : "labels"}`);
    setLabels([]);
    setLabelsOpen(false);
  }

  const count = selectedIds.length;

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-2rem)] bg-surface rounded-lg px-3 py-2 shadow-[var(--shadow-overlay)] flex flex-wrap items-center gap-2"
    >
      <span className="text-sm font-medium text-foreground whitespace-nowrap">{count} selected</span>

      <select
        aria-label="Change status"
        value=""
        disabled={isPending}
        onChange={(e) => {
          const s = statuses.find((x) => x.id === e.target.value);
          if (s) apply({ statusId: s.id }, `Moved to ${s.name}`);
        }}
        className={selectClass}
      >
        <option value="" disabled>Status…</option>
        {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      <select
        aria-label="Change assignee"
        value=""
        disabled={isPending}
        onChange={(e) => {
          const v = e.target.value;
          if (v === UNASSIGNED) apply({ assigneeId: null }, "Unassigned");
          else {
            const m = members.find((x) => x.id === v);
            if (m) apply({ assigneeId: m.id }, `Assigned to ${m.name}`);
          }
        }}
        className={selectClass}
      >
        <option value="" disabled>Assignee…</option>
        <option value={UNASSIGNED}>Unassigned</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>

      <select
        aria-label="Change priority"
        value=""
        disabled={isPending}
        onChange={(e) => {
          const p = e.target.value as IssuePriority;
          apply({ priority: p }, `Priority set to ${PRIORITY_CONFIG[p].label}`);
        }}
        className={selectClass}
      >
        <option value="" disabled>Priority…</option>
        {(Object.keys(PRIORITY_CONFIG) as IssuePriority[]).map((p) => (
          <option key={p} value={p}>{PRIORITY_CONFIG[p].label}</option>
        ))}
      </select>

      {sprints && (
        <select
          aria-label="Add to sprint"
          value=""
          disabled={isPending}
          onChange={(e) => {
            const v = e.target.value;
            if (v === BACKLOG) apply({ sprintId: null }, "Moved to backlog");
            else {
              const sp = sprints.find((x) => x.id === v);
              if (sp) apply({ sprintId: sp.id }, `Added to ${sp.name}`);
            }
          }}
          className={selectClass}
        >
          <option value="" disabled>Sprint…</option>
          {sprints.map((sp) => (
            <option key={sp.id} value={sp.id}>{sp.name}{sp.status === "ACTIVE" ? " (active)" : ""}</option>
          ))}
          <option value={BACKLOG}>Backlog (no sprint)</option>
        </select>
      )}

      <div className="relative">
        <Button variant="outline" size="sm" disabled={isPending} onClick={() => setLabelsOpen((o) => !o)} aria-expanded={labelsOpen}>
          Labels
        </Button>
        {labelsOpen && (
          <div className="absolute bottom-full mb-2 left-0 w-72 bg-surface rounded-lg p-3 shadow-[var(--shadow-overlay)] space-y-2">
            <LabelInput labels={labels} onChange={setLabels} placeholder="Label name…" />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" disabled={labels.length === 0 || isPending} onClick={() => applyLabels("remove")}>
                Remove
              </Button>
              <Button variant="default" size="sm" disabled={labels.length === 0 || isPending} onClick={() => applyLabels("add")}>
                Add
              </Button>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        title="Clear selection"
        className="ml-1 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-active"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
