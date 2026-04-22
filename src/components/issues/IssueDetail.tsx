"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { IssueStatus, IssuePriority, IssueType } from "@prisma/client";
import { updateIssue, deleteIssue } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { STATUS_CONFIG, PRIORITY_CONFIG, TYPE_CONFIG } from "@/lib/issue-utils";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { LabelInput } from "@/components/issues/LabelInput";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CommentThread } from "@/components/comments/CommentThread";
import { CommentForm } from "@/components/comments/CommentForm";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { AttachmentsPanel } from "@/components/attachments/AttachmentsPanel";

type User = { id: string; name: string; avatarUrl: string | null };
type ActivityLog = {
  id: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
  user: { id: string; name: string };
};
type Comment = {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: User;
};
type Issue = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  type: IssueType;
  assigneeId: string | null;
  labels: string[];
  createdAt: Date;
  updatedAt: Date;
  assignee: User | null;
  reporter: User & { avatarUrl: string | null };
  comments: Comment[];
  activityLogs: ActivityLog[];
  project: { id: string; key: string; name: string };
};

interface IssueDetailProps {
  issue: Issue;
  members: User[];
  projectKey: string;
  currentUserId: string;
  currentUserName: string;
  canEdit: boolean;
}

function EditableTitle({ value, issueId, projectKey, onSaved }: {
  value: string;
  issueId: string;
  projectKey: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(value);
  const [isPending, startTransition] = useTransition();

  function save() {
    if (!title.trim() || title === value) { setEditing(false); return; }
    startTransition(async () => {
      await updateIssue(projectKey, issueId, { title: title.trim() });
      setEditing(false);
      onSaved();
    });
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1 text-xl font-bold bg-zinc-50 dark:bg-zinc-800 border border-indigo-500 rounded px-2 py-1 text-zinc-900 dark:text-zinc-100 focus:outline-none"
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setTitle(value); setEditing(false); } }}
          autoFocus
        />
        <button onClick={save} disabled={isPending} className="p-1 text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 dark:hover:text-emerald-300"><Check className="w-4 h-4" /></button>
        <button onClick={() => { setTitle(value); setEditing(false); }} className="p-1 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"><X className="w-4 h-4" /></button>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 group">
      <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex-1">{value}</h1>
      <button
        onClick={() => setEditing(true)}
        className="p-1 text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

const selectClass = "w-full px-2 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50";

function InlineSelect<T extends string>({ label, value, options, issueId, projectKey, fieldKey, onSaved }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  issueId: string;
  projectKey: string;
  fieldKey: string;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(newValue: T) {
    if (newValue === value) return;
    startTransition(async () => {
      await updateIssue(projectKey, issueId, { [fieldKey]: newValue } as Parameters<typeof updateIssue>[2]);
      toast.success("Issue updated");
      onSaved();
    });
  }

  return (
    <div>
      <p className="text-xs text-zinc-500 font-medium mb-1">{label}</p>
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value as T)}
        disabled={isPending}
        className={selectClass + " min-h-[44px]"}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function IssueDetail({ issue, members, projectKey, currentUserId, currentUserName, canEdit }: IssueDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingDesc, setEditingDesc] = useState(false);
  const [description, setDescription] = useState(issue.description ?? "");
  const [labels, setLabels] = useState<string[]>(issue.labels);

  useEffect(() => { setLabels(issue.labels); }, [issue.labels]);

  const currentUserInitial = currentUserName.charAt(0).toUpperCase();

  function refresh() { router.refresh(); }

  function saveDescription() {
    startTransition(async () => {
      await updateIssue(projectKey, issue.id, { description: description.trim() || null });
      setEditingDesc(false);
      toast.success("Description updated");
      refresh();
    });
  }

  function handleLabelsChange(newLabels: string[]) {
    setLabels(newLabels);
    startTransition(async () => {
      await updateIssue(projectKey, issue.id, { labels: newLabels });
      toast.success("Labels updated");
      refresh();
    });
  }

  function handleDelete() {
    if (!confirm(`Delete issue ${issue.key}? This cannot be undone.`)) return;
    startTransition(async () => {
      toast.success("Issue deleted");
      await deleteIssue(projectKey, issue.id);
    });
  }

  const statusOptions = (Object.keys(STATUS_CONFIG) as IssueStatus[]).map((s) => ({
    value: s,
    label: STATUS_CONFIG[s].label,
  }));
  const priorityOptions = (Object.keys(PRIORITY_CONFIG) as IssuePriority[]).map((p) => ({
    value: p,
    label: PRIORITY_CONFIG[p].label,
  }));
  const typeOptions = (Object.keys(TYPE_CONFIG) as IssueType[]).map((t) => ({
    value: t,
    label: `${TYPE_CONFIG[t].icon} ${TYPE_CONFIG[t].label}`,
  }));
  const assigneeOptions: { value: string; label: string }[] = [
    { value: "", label: "Unassigned" },
    ...members.map((m) => ({ value: m.id, label: m.name })),
  ];

  return (
    <div className="max-w-5xl min-w-0">
      <div className="flex items-center gap-2 text-sm text-zinc-500 mb-4">
        <span className="font-mono text-indigo-600 dark:text-indigo-400">{issue.key}</span>
        <span>·</span>
        <span>{issue.project.name}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
        {/* Main content */}
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4">
            <div className="flex-1 min-w-0 w-full sm:w-auto">
              <EditableTitle
                value={issue.title}
                issueId={issue.id}
                projectKey={projectKey}
                onSaved={refresh}
              />
            </div>
            <Button
              onClick={handleDelete}
              variant="destructive"
              size="sm"
              disabled={isPending}
              className="flex-shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Delete
            </Button>
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Description</h3>
              {!editingDesc && (
                <button
                  onClick={() => setEditingDesc(true)}
                  className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 flex items-center gap-1"
                >
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              )}
            </div>
            {editingDesc ? (
              <div className="space-y-2">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                  placeholder="Add a description..."
                />
                <div className="flex gap-2">
                  <button onClick={saveDescription} disabled={isPending} className="flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition-colors disabled:opacity-50">
                    <Check className="w-3.5 h-3.5" /> Save
                  </button>
                  <button onClick={() => { setDescription(issue.description ?? ""); setEditingDesc(false); }} className="flex items-center gap-1 px-3 py-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 text-xs border border-zinc-300 dark:border-zinc-700 rounded-lg">
                    <X className="w-3.5 h-3.5" /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => setEditingDesc(true)}
                className="min-h-[60px] p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
              >
                {issue.description ? (
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{issue.description}</p>
                ) : (
                  <p className="text-sm text-zinc-400 dark:text-zinc-600 italic">Click to add a description...</p>
                )}
              </div>
            )}
          </div>

          {/* Labels */}
          <div>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Labels</h3>
            <LabelInput labels={labels} onChange={handleLabelsChange} disabled={isPending} />
          </div>

          {/* Attachments */}
          <div>
            <AttachmentsPanel
              issueId={issue.id}
              projectId={issue.project.id}
              canEdit={canEdit}
              currentUserId={currentUserId}
            />
          </div>

          {/* Comments */}
          <div>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-4">
              Comments
              {issue.comments.length > 0 && (
                <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-600 bg-zinc-100 dark:bg-zinc-800 rounded px-1.5 py-0.5 font-mono">
                  {issue.comments.length}
                </span>
              )}
            </h3>
            <div className="space-y-5 mb-5">
              <CommentThread
                comments={issue.comments}
                projectKey={projectKey}
                currentUserId={currentUserId}
              />
            </div>
            <CommentForm
              projectKey={projectKey}
              issueId={issue.id}
              currentUserName={currentUserName}
              currentUserInitial={currentUserInitial}
            />
          </div>

          {/* Activity */}
          <div>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">Activity</h3>
            <ActivityFeed entries={issue.activityLogs} />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-4">
            <InlineSelect
              label="Status"
              value={issue.status}
              options={statusOptions}
              issueId={issue.id}
              projectKey={projectKey}
              fieldKey="status"
              onSaved={refresh}
            />
            <InlineSelect
              label="Priority"
              value={issue.priority}
              options={priorityOptions}
              issueId={issue.id}
              projectKey={projectKey}
              fieldKey="priority"
              onSaved={refresh}
            />
            <InlineSelect
              label="Type"
              value={issue.type}
              options={typeOptions}
              issueId={issue.id}
              projectKey={projectKey}
              fieldKey="type"
              onSaved={refresh}
            />
            <div>
              <p className="text-xs text-zinc-500 font-medium mb-1">Assignee</p>
              <select
                value={issue.assigneeId ?? ""}
                onChange={(e) => {
                  startTransition(async () => {
                    await updateIssue(projectKey, issue.id, { assigneeId: e.target.value || null });
                    toast.success("Assignee updated");
                    refresh();
                  });
                }}
                className={selectClass + " min-h-[44px]"}
              >
                {assigneeOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-3 text-xs">
            <div>
              <p className="text-zinc-500">Reporter</p>
              <p className="text-zinc-700 dark:text-zinc-300 mt-0.5">{issue.reporter.name}</p>
            </div>
            <div>
              <p className="text-zinc-500">Created</p>
              <p className="text-zinc-700 dark:text-zinc-300 mt-0.5">{new Date(issue.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-zinc-500">Updated</p>
              <p className="text-zinc-700 dark:text-zinc-300 mt-0.5">{new Date(issue.updatedAt).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
