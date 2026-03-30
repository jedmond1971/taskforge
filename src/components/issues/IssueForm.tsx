"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IssueStatus, IssuePriority, IssueType } from "@prisma/client";
import { createIssue, updateIssue } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { STATUS_CONFIG, PRIORITY_CONFIG, TYPE_CONFIG } from "@/lib/issue-utils";

type ProjectMember = {
  user: { id: string; name: string; avatarUrl: string | null };
};

type ExistingIssue = {
  id: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  type: IssueType;
  assigneeId: string | null;
  labels: string[];
};

interface IssueFormProps {
  projectKey: string;
  members: ProjectMember[];
  issue?: ExistingIssue;
  defaultStatus?: IssueStatus;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function IssueForm({ projectKey, members, issue, defaultStatus, onSuccess, onCancel }: IssueFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(issue?.title ?? "");
  const [description, setDescription] = useState(issue?.description ?? "");
  const [status, setStatus] = useState<IssueStatus>(issue?.status ?? defaultStatus ?? "TODO");
  const [priority, setPriority] = useState<IssuePriority>(issue?.priority ?? "MEDIUM");
  const [type, setType] = useState<IssueType>(issue?.type ?? "TASK");
  const [assigneeId, setAssigneeId] = useState<string>(issue?.assigneeId ?? "");
  const [labelsStr, setLabelsStr] = useState(issue?.labels.join(", ") ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) { setError("Title is required"); return; }

    const formData = {
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      priority,
      type,
      assigneeId: assigneeId || undefined,
      labels: labelsStr.split(",").map((l) => l.trim()).filter(Boolean),
    };

    startTransition(async () => {
      try {
        if (issue) {
          await updateIssue(projectKey, issue.id, {
            ...formData,
            description: description.trim() || null,
            assigneeId: assigneeId || null,
          });
          toast.success("Issue updated");
        } else {
          await createIssue(projectKey, formData);
          toast.success("Issue created");
        }
        onSuccess?.();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-zinc-300">Title *</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Issue title"
          required
          className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-zinc-300">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add a description..."
          rows={4}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-zinc-300">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as IssueStatus)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {(Object.keys(STATUS_CONFIG) as IssueStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-zinc-300">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as IssuePriority)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {(Object.keys(PRIORITY_CONFIG) as IssuePriority[]).map((p) => (
              <option key={p} value={p}>{PRIORITY_CONFIG[p].label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-zinc-300">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as IssueType)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {(Object.keys(TYPE_CONFIG) as IssueType[]).map((t) => (
              <option key={t} value={t}>{TYPE_CONFIG[t].icon} {TYPE_CONFIG[t].label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-zinc-300">Assignee</label>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.user.id} value={m.user.id}>{m.user.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-zinc-300">Labels <span className="text-zinc-500 font-normal">(comma separated)</span></label>
        <Input
          value={labelsStr}
          onChange={(e) => setLabelsStr(e.target.value)}
          placeholder="bug, frontend, urgent"
          className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isPending} className="bg-indigo-600 hover:bg-indigo-500 text-white">
          {isPending ? (issue ? "Saving..." : "Creating...") : (issue ? "Save Changes" : "Create Issue")}
        </Button>
      </div>
    </form>
  );
}
