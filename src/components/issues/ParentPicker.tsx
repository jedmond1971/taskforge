"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import Link from "next/link";
import { Plus, X, Search, Pencil } from "lucide-react";
import { IssueType, StatusCategory } from "@prisma/client";
import { setIssueParent, searchIssuesForParent } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { StatusBadge } from "@/components/issues/StatusBadge";
import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { toast } from "sonner";

type PickerIssueStatus = { id: string; name: string; category: StatusCategory };

export type PickerIssue = {
  id: string;
  key: string;
  title: string;
  type: IssueType;
  projectStatus: PickerIssueStatus;
};

export function IssuePickerDialog({
  projectKey,
  excludeIssueId,
  excludeIds,
  title,
  onSelect,
  onClose,
}: {
  projectKey: string;
  excludeIssueId: string;
  excludeIds?: Set<string>;
  title: string;
  onSelect: (issue: PickerIssue) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const issues = await searchIssuesForParent(projectKey, query, excludeIssueId);
        setResults(excludeIds ? issues.filter((i) => !excludeIds.has(i.id)) : issues);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, projectKey, excludeIssueId, excludeIds]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg">
            <Search className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by key or title…"
              className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 outline-none"
            />
          </div>
        </div>

        <div className="px-2 pb-3 max-h-64 overflow-y-auto">
          {loading ? (
            <p className="text-center text-sm text-zinc-400 py-6">Searching…</p>
          ) : !query.trim() ? (
            <p className="text-center text-sm text-zinc-400 py-6">Type to search for an issue.</p>
          ) : results.length === 0 ? (
            <p className="text-center text-sm text-zinc-400 py-6">No matching issues found.</p>
          ) : (
            results.map((issue) => (
              <button
                key={issue.id}
                onClick={() => onSelect(issue)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left"
              >
                <IssueTypeIcon type={issue.type} size={16} />
                <span className="text-xs font-mono text-zinc-400 shrink-0">{issue.key}</span>
                <span className="text-sm text-zinc-700 dark:text-zinc-300 flex-1 truncate">{issue.title}</span>
                <StatusBadge status={issue.projectStatus} className="shrink-0" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function ParentPicker({
  issueId,
  projectKey,
  currentParent,
  canEdit,
  onChanged,
}: {
  issueId: string;
  projectKey: string;
  currentParent: PickerIssue | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSelect(issue: PickerIssue) {
    setPickerOpen(false);
    startTransition(async () => {
      try {
        await setIssueParent(projectKey, issueId, issue.id);
        toast.success("Parent updated");
        onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update parent");
      }
    });
  }

  function handleClear() {
    startTransition(async () => {
      try {
        await setIssueParent(projectKey, issueId, null);
        toast.success("Parent removed");
        onChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to remove parent");
      }
    });
  }

  return (
    <>
      {pickerOpen && (
        <IssuePickerDialog
          projectKey={projectKey}
          excludeIssueId={issueId}
          title={currentParent ? "Change parent" : "Add parent"}
          onSelect={handleSelect}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {currentParent ? (
        <span className="flex items-center gap-1.5 group">
          <IssueTypeIcon type={currentParent.type} size={16} />
          <Link
            href={`/projects/${projectKey}/issues/${currentParent.key}`}
            className="font-mono text-primary hover:text-primary/80 hover:underline"
          >
            {currentParent.key}
          </Link>
          <span className="text-zinc-400 dark:text-zinc-600 truncate max-w-[10rem]">{currentParent.title}</span>
          <StatusBadge status={currentParent.projectStatus} className="shrink-0" />
          {canEdit && (
            <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => setPickerOpen(true)}
                disabled={isPending}
                className="p-0.5 text-zinc-400 hover:text-primary/80 disabled:opacity-50"
                title="Change parent"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                onClick={handleClear}
                disabled={isPending}
                className="p-0.5 text-zinc-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50"
                title="Remove parent"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}
        </span>
      ) : canEdit ? (
        <button
          onClick={() => setPickerOpen(true)}
          disabled={isPending}
          className="flex items-center gap-1 text-zinc-500 hover:text-primary/80 transition-colors disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" />
          Add parent
        </button>
      ) : null}
    </>
  );
}
