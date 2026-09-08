"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusCategory, IssuePriority, IssueType } from "@prisma/client";
import { PRIORITY_CONFIG, TYPE_CONFIG } from "@/lib/issue-utils";
import { LabelInput } from "@/components/issues/LabelInput";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { bulkUpdateIssueFields, type BulkIssueUpdates } from "@/app/(dashboard)/projects/[projectKey]/actions";

type ProjectStatus = { id: string; name: string; category: StatusCategory };
type Member = { id: string; name: string; avatarUrl: string | null };

interface BulkEditPanelProps {
  projectKey: string;
  selectedIds: string[];
  statuses: ProjectStatus[];
  members: Member[];
  onSuccess: () => void;
}

const selectClass =
  "px-3 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto min-w-[160px]";

function FieldRow({
  checked,
  onCheckedChange,
  label,
  children,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-3 border-b border-zinc-100 dark:border-zinc-800/50 last:border-b-0">
      <label className="flex items-center gap-2 w-44 shrink-0 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="rounded border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-primary focus:ring-primary cursor-pointer"
        />
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      </label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export function BulkEditPanel({ projectKey, selectedIds, statuses, members, onSuccess }: BulkEditPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [changeStatus, setChangeStatus] = useState(false);
  const [statusId, setStatusId] = useState(statuses[0]?.id ?? "");

  const [changePriority, setChangePriority] = useState(false);
  const [priority, setPriority] = useState<IssuePriority>("MEDIUM");

  const [changeType, setChangeType] = useState(false);
  const [type, setType] = useState<IssueType>("TASK");

  const [changeAssignee, setChangeAssignee] = useState(false);
  const [assigneeId, setAssigneeId] = useState<string>("");

  const [changeDueDate, setChangeDueDate] = useState(false);
  const [dueDate, setDueDate] = useState<string>("");

  const [addLabelsChecked, setAddLabelsChecked] = useState(false);
  const [addLabels, setAddLabels] = useState<string[]>([]);

  const [removeLabelsChecked, setRemoveLabelsChecked] = useState(false);
  const [removeLabels, setRemoveLabels] = useState<string[]>([]);

  const priorityOptions = (Object.keys(PRIORITY_CONFIG) as IssuePriority[]).map((p) => ({
    value: p,
    label: PRIORITY_CONFIG[p].label,
  }));
  const typeOptions = (Object.keys(TYPE_CONFIG) as IssueType[]).map((t) => ({
    value: t,
    label: TYPE_CONFIG[t].label,
  }));

  const hasAddLabels = addLabelsChecked && addLabels.length > 0;
  const hasRemoveLabels = removeLabelsChecked && removeLabels.length > 0;
  const labelConflict = hasAddLabels && hasRemoveLabels && addLabels.some((l) => removeLabels.includes(l));

  const anyFieldChecked =
    changeStatus || changePriority || changeType || changeAssignee || changeDueDate || hasAddLabels || hasRemoveLabels;
  const submitDisabled = selectedIds.length === 0 || !anyFieldChecked || labelConflict;

  function buildSummary(): string {
    const parts: string[] = [];
    if (changeStatus) {
      const s = statuses.find((s) => s.id === statusId);
      parts.push(`status → ${s?.name ?? "—"}`);
    }
    if (changePriority) parts.push(`priority → ${PRIORITY_CONFIG[priority].label}`);
    if (changeType) parts.push(`type → ${TYPE_CONFIG[type].label}`);
    if (changeAssignee) {
      const m = members.find((m) => m.id === assigneeId);
      parts.push(`assignee → ${assigneeId ? m?.name ?? "—" : "Unassigned"}`);
    }
    if (changeDueDate) parts.push(`due date → ${dueDate ? new Date(dueDate).toLocaleDateString() : "cleared"}`);
    if (hasAddLabels) parts.push(`add label${addLabels.length > 1 ? "s" : ""} ${addLabels.map((l) => `"${l}"`).join(", ")}`);
    if (hasRemoveLabels) parts.push(`remove label${removeLabels.length > 1 ? "s" : ""} ${removeLabels.map((l) => `"${l}"`).join(", ")}`);

    const fieldNames = ["Status", "Priority", "Type", "Assignee", "Due date"];
    const checkedFieldNames = [
      changeStatus && "Status",
      changePriority && "Priority",
      changeType && "Type",
      changeAssignee && "Assignee",
      changeDueDate && "Due date",
    ].filter(Boolean) as string[];
    const unchanged = fieldNames.filter((f) => !checkedFieldNames.includes(f));

    let summary = `This will update ${selectedIds.length} issue${selectedIds.length !== 1 ? "s" : ""}: ${parts.join(", ")}.`;
    if (unchanged.length > 0 && unchanged.length < fieldNames.length) {
      summary += ` ${unchanged.join(", ")} will be left unchanged.`;
    }
    return summary;
  }

  function handleConfirm() {
    startTransition(async () => {
      const updates: BulkIssueUpdates = {};
      if (changeStatus) updates.statusId = statusId;
      if (changePriority) updates.priority = priority;
      if (changeType) updates.type = type;
      if (changeAssignee) updates.assigneeId = assigneeId || null;
      if (changeDueDate) updates.dueDate = dueDate ? new Date(dueDate) : null;
      if (hasAddLabels) updates.addLabels = addLabels;
      if (hasRemoveLabels) updates.removeLabels = removeLabels;

      try {
        const result = await bulkUpdateIssueFields(projectKey, selectedIds, updates);
        toast.success(`Updated ${result.count} issue${result.count !== 1 ? "s" : ""}`);
        onSuccess();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Bulk update failed");
      }
    });
  }

  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 space-y-1">
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm bulk update"
        description={buildSummary()}
        confirmLabel="Apply"
        variant="default"
        onConfirm={handleConfirm}
      />

      <FieldRow checked={changeStatus} onCheckedChange={setChangeStatus} label="Status">
        <select
          value={statusId}
          onChange={(e) => setStatusId(e.target.value)}
          disabled={!changeStatus}
          className={selectClass}
        >
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow checked={changePriority} onCheckedChange={setChangePriority} label="Priority">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as IssuePriority)}
          disabled={!changePriority}
          className={selectClass}
        >
          {priorityOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow checked={changeType} onCheckedChange={setChangeType} label="Type">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as IssueType)}
          disabled={!changeType}
          className={selectClass}
        >
          {typeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow checked={changeAssignee} onCheckedChange={setChangeAssignee} label="Assignee">
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          disabled={!changeAssignee}
          className={selectClass}
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </FieldRow>

      <FieldRow checked={changeDueDate} onCheckedChange={setChangeDueDate} label="Due Date">
        <div className="flex flex-col gap-1">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={!changeDueDate}
            className={selectClass}
          />
          {changeDueDate && (
            <p className="text-xs text-zinc-400 dark:text-zinc-600">Leave blank to clear the due date.</p>
          )}
        </div>
      </FieldRow>

      <FieldRow checked={addLabelsChecked} onCheckedChange={setAddLabelsChecked} label="Add Labels">
        <LabelInput labels={addLabels} onChange={setAddLabels} placeholder="Label to add..." disabled={!addLabelsChecked} />
      </FieldRow>

      <FieldRow checked={removeLabelsChecked} onCheckedChange={setRemoveLabelsChecked} label="Remove Labels">
        <LabelInput labels={removeLabels} onChange={setRemoveLabels} placeholder="Label to remove..." disabled={!removeLabelsChecked} />
      </FieldRow>

      {labelConflict && (
        <p className="text-xs text-red-600 dark:text-red-400 pt-2">
          The same label can&apos;t be in both Add Labels and Remove Labels.
        </p>
      )}

      <div className="pt-4 flex justify-end">
        <Button
          variant="default"
          disabled={submitDisabled || isPending}
          onClick={() => setConfirmOpen(true)}
        >
          Apply to {selectedIds.length} issue{selectedIds.length !== 1 ? "s" : ""}
        </Button>
      </div>
    </div>
  );
}
