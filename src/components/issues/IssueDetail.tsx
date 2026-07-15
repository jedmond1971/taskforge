"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatusCategory, IssuePriority, IssueType, IssueLinkType, DocPageType, CustomFieldType } from "@prisma/client";
import { updateIssue, deleteIssue } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { CATEGORY_COLOR, PRIORITY_CONFIG, TYPE_CONFIG } from "@/lib/issue-utils";
import { Pencil, Trash2, Check, X, ChevronRight, Plus } from "lucide-react";
import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { LabelInput } from "@/components/issues/LabelInput";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CommentThread } from "@/components/comments/CommentThread";
import { CommentForm } from "@/components/comments/CommentForm";
import { ActivityFeed } from "@/components/activity/ActivityFeed";
import { AttachmentsPanel } from "@/components/attachments/AttachmentsPanel";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { RichTextDisplay } from "@/components/ui/rich-text-display";
import { CreateIssueDialog } from "@/components/issues/CreateIssueDialog";
import { RelatedDocsSection } from "@/components/issues/RelatedDocsSection";
import { LinkedIssuesSection } from "@/components/issues/LinkedIssuesSection";
import { CustomFieldsPanel } from "@/components/issues/CustomFieldsPanel";

type User = { id: string; name: string; avatarUrl: string | null };
type ActivityLog = {
  id: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
  user: { id: string; name: string } | null;
};
type Comment = {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author: User;
};
type ProjectStatus = { id: string; name: string; category: StatusCategory };

type SubIssue = {
  id: string;
  key: string;
  title: string;
  projectStatus: ProjectStatus;
  priority: IssuePriority;
  assignee: User | null;
};
type ParentIssue = {
  id: string;
  key: string;
  title: string;
  projectStatus: ProjectStatus;
};
type DocLink = {
  id: string;
  pageId: string;
  page: { id: string; title: string; type: DocPageType };
};
type LinkedIssueItem = {
  id: string;
  key: string;
  title: string;
  projectStatus: ProjectStatus;
};
type OutgoingLink = { id: string; linkType: IssueLinkType; targetIssue: LinkedIssueItem };
type IncomingLink = { id: string; linkType: IssueLinkType; sourceIssue: LinkedIssueItem };

type Issue = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  statusId: string;
  projectStatus: ProjectStatus;
  priority: IssuePriority;
  type: IssueType;
  assigneeId: string | null;
  parentId: string | null;
  labels: string[];
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignee: User | null;
  reporter: User & { avatarUrl: string | null };
  parent: ParentIssue | null;
  children: SubIssue[];
  comments: Comment[];
  activityLogs: ActivityLog[];
  project: { id: string; key: string; name: string };
  docLinks: DocLink[];
  outgoingLinks: OutgoingLink[];
  incomingLinks: IncomingLink[];
};

type CustomField = {
  id: string;
  name: string;
  type: CustomFieldType;
  options: string[];
  position: number;
};

interface IssueDetailProps {
  issue: Issue;
  members: User[];
  statuses: ProjectStatus[];
  projectKey: string;
  currentUserId: string;
  currentUserName: string;
  canEdit: boolean;
  customFields: CustomField[];
  customFieldValues: Record<string, string | number | boolean | string[]>;
}

function EditableTitle({ value, issueId, projectKey, onSaved, canEdit }: {
  value: string;
  issueId: string;
  projectKey: string;
  onSaved: () => void;
  canEdit: boolean;
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
      {canEdit && (
        <button
          onClick={() => setEditing(true)}
          className="p-1 text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

const selectClass = "w-full px-2 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50";

function InlineSelect<T extends string>({ label, value, options, issueId, projectKey, fieldKey, onSaved, disabled: extraDisabled = false }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  issueId: string;
  projectKey: string;
  fieldKey: string;
  onSaved: () => void;
  disabled?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(newValue: T) {
    if (newValue === value || extraDisabled) return;
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
        disabled={isPending || extraDisabled}
        className={selectClass + " min-h-[44px]"}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function SubIssueRow({ subIssue, projectKey }: { subIssue: SubIssue; projectKey: string }) {
  const statusCfg = CATEGORY_COLOR[subIssue.projectStatus.category];
  const priorityCfg = PRIORITY_CONFIG[subIssue.priority];

  return (
    <Link
      href={`/projects/${projectKey}/issues/${subIssue.key}`}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors group"
    >
      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${statusCfg.color} ${statusCfg.bg} whitespace-nowrap`}>
        {subIssue.projectStatus.name}
      </span>
      <span className="font-mono text-xs text-indigo-500 dark:text-indigo-400 shrink-0">{subIssue.key}</span>
      <span className="text-sm text-zinc-700 dark:text-zinc-300 flex-1 truncate group-hover:text-zinc-900 dark:group-hover:text-zinc-100">
        {subIssue.title}
      </span>
      <span className="text-xs text-zinc-400 dark:text-zinc-600 shrink-0">{priorityCfg.label}</span>
      {subIssue.assignee && (
        <span className="text-xs text-zinc-400 dark:text-zinc-500 shrink-0 hidden sm:block">{subIssue.assignee.name}</span>
      )}
    </Link>
  );
}

export function IssueDetail({ issue, members, statuses, projectKey, currentUserId, currentUserName, canEdit, customFields, customFieldValues }: IssueDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingDesc, setEditingDesc] = useState(false);
  const [description, setDescription] = useState(issue.description ?? "");
  const [labels, setLabels] = useState<string[]>(issue.labels);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [subIssueDialogOpen, setSubIssueDialogOpen] = useState(false);
  const [dueDate, setDueDate] = useState<string>(
    issue.dueDate ? new Date(issue.dueDate).toISOString().split("T")[0] : ""
  );
  const savedDueDate = useRef<string>(
    issue.dueDate ? new Date(issue.dueDate).toISOString().split("T")[0] : ""
  );

  useEffect(() => { setLabels(issue.labels); }, [issue.labels]);

  const currentUserInitial = currentUserName.charAt(0).toUpperCase();

  function refresh() { router.refresh(); }

  function saveDescription() {
    startTransition(async () => {
      await updateIssue(projectKey, issue.id, { description: description || null });
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
    setConfirmDeleteOpen(true);
  }

  function handleConfirmDelete() {
    startTransition(async () => {
      toast.success("Issue deleted");
      await deleteIssue(projectKey, issue.id);
    });
  }

  const statusOptions = statuses.map((s) => ({ value: s.id, label: s.name }));
  const priorityOptions = (Object.keys(PRIORITY_CONFIG) as IssuePriority[]).map((p) => ({
    value: p,
    label: PRIORITY_CONFIG[p].label,
  }));
  const typeOptions = (Object.keys(TYPE_CONFIG) as IssueType[]).map((t) => ({
    value: t,
    label: TYPE_CONFIG[t].label,
  }));
  const assigneeOptions: { value: string; label: string }[] = [
    { value: "", label: "Unassigned" },
    ...members.map((m) => ({ value: m.id, label: m.name })),
  ];

  return (
    <>
    <ConfirmDialog
      open={confirmDeleteOpen}
      onOpenChange={setConfirmDeleteOpen}
      title={`Delete ${issue.key}?`}
      description="This issue and all its comments and attachments will be permanently deleted. This action cannot be undone."
      confirmLabel="Delete"
      onConfirm={handleConfirmDelete}
    />
    <CreateIssueDialog
      projectKey={projectKey}
      open={subIssueDialogOpen}
      onOpenChange={(open) => {
        setSubIssueDialogOpen(open);
        if (!open) refresh();
      }}
      parentId={issue.id}
    />
    <div className="max-w-5xl min-w-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-zinc-500 mb-4 flex-wrap">
        {issue.parent ? (
          <>
            <Link
              href={`/projects/${projectKey}/issues/${issue.parent.key}`}
              className="font-mono text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 hover:underline"
            >
              {issue.parent.key}
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span className="flex items-center gap-1.5">
              <IssueTypeIcon type={issue.type} size={20} />
              <span className="font-mono text-indigo-600 dark:text-indigo-400">{issue.key}</span>
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1.5">
            <IssueTypeIcon type={issue.type} size={20} />
            <span className="font-mono text-indigo-600 dark:text-indigo-400">{issue.key}</span>
          </span>
        )}
        <span>·</span>
        <span>{issue.project.name}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
        {/* Main content */}
        <div className="space-y-6">
          <EditableTitle
            value={issue.title}
            issueId={issue.id}
            projectKey={projectKey}
            onSaved={refresh}
            canEdit={canEdit}
          />

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Description</h3>
              {!editingDesc && canEdit && (
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
                <RichTextEditor
                  value={description}
                  onChange={setDescription}
                  placeholder="Add a description..."
                  minHeight="140px"
                  disabled={isPending}
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
                onClick={canEdit ? () => setEditingDesc(true) : undefined}
                className={`min-h-[60px] p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-colors${canEdit ? " cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700" : ""}`}
              >
                {issue.description ? (
                  <RichTextDisplay content={issue.description} />
                ) : (
                  <p className="text-sm text-zinc-400 dark:text-zinc-600 italic">
                    {canEdit ? "Click to add a description..." : "No description."}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Sub-Issues */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                Sub-Issues
                {issue.children.length > 0 && (
                  <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-600 bg-zinc-100 dark:bg-zinc-800 rounded px-1.5 py-0.5 font-mono">
                    {issue.children.length}
                  </span>
                )}
              </h3>
              {canEdit && (
                <button
                  onClick={() => setSubIssueDialogOpen(true)}
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add sub-issue
                </button>
              )}
            </div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
              {issue.children.length === 0 ? (
                <p className="text-sm text-zinc-400 dark:text-zinc-600 italic px-3 py-3">
                  No sub-issues yet.{canEdit ? " Click \"Add sub-issue\" to create one." : ""}
                </p>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {issue.children.map((child) => (
                    <SubIssueRow key={child.id} subIssue={child} projectKey={projectKey} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Related Docs */}
          <RelatedDocsSection
            issueId={issue.id}
            projectKey={projectKey}
            initialLinks={issue.docLinks}
            canEdit={canEdit}
          />

          {/* Linked Issues */}
          <LinkedIssuesSection
            issueId={issue.id}
            projectKey={projectKey}
            initialOutgoing={issue.outgoingLinks}
            initialIncoming={issue.incomingLinks}
            canEdit={canEdit}
          />

          {/* Labels */}
          <div>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Labels</h3>
            <LabelInput labels={labels} onChange={handleLabelsChange} disabled={isPending || !canEdit} />
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
              value={issue.statusId}
              options={statusOptions}
              issueId={issue.id}
              projectKey={projectKey}
              fieldKey="statusId"
              onSaved={refresh}
              disabled={!canEdit}
            />
            <InlineSelect
              label="Priority"
              value={issue.priority}
              options={priorityOptions}
              issueId={issue.id}
              projectKey={projectKey}
              fieldKey="priority"
              onSaved={refresh}
              disabled={!canEdit}
            />
            <InlineSelect
              label="Type"
              value={issue.type}
              options={typeOptions}
              issueId={issue.id}
              projectKey={projectKey}
              fieldKey="type"
              onSaved={refresh}
              disabled={!canEdit}
            />
            <div>
              <p className="text-xs text-zinc-500 font-medium mb-1">Assignee</p>
              <select
                value={issue.assigneeId ?? ""}
                onChange={(e) => {
                  if (!canEdit) return;
                  startTransition(async () => {
                    await updateIssue(projectKey, issue.id, { assigneeId: e.target.value || null });
                    toast.success("Assignee updated");
                    refresh();
                  });
                }}
                disabled={isPending || !canEdit}
                className={selectClass + " min-h-[44px]"}
              >
                {assigneeOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-xs text-zinc-500 font-medium mb-1">Due Date</p>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  if (!canEdit) return;
                  setDueDate(e.target.value);
                }}
                onBlur={(e) => {
                  if (!canEdit) return;
                  const newVal = e.target.value;
                  if (newVal === savedDueDate.current) return;
                  savedDueDate.current = newVal;
                  startTransition(async () => {
                    await updateIssue(projectKey, issue.id, {
                      dueDate: newVal ? new Date(newVal) : null,
                    });
                    toast.success(newVal ? "Due date set" : "Due date cleared");
                    refresh();
                  });
                }}
                disabled={isPending || !canEdit}
                className={selectClass}
              />
            </div>
          </div>

          {customFields.length > 0 && (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-3">Custom Fields</p>
              <CustomFieldsPanel
                issueId={issue.id}
                projectKey={projectKey}
                fields={customFields}
                initialValues={customFieldValues}
                canEdit={canEdit}
                onSaved={refresh}
              />
            </div>
          )}

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

          {canEdit && (
            <Button
              onClick={handleDelete}
              variant="destructive"
              size="sm"
              disabled={isPending}
              className="w-full"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Delete Issue
            </Button>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
