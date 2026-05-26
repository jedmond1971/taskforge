"use client";

import { useState } from "react";
import { RotateCcw, Eye, X } from "lucide-react";
import { RichTextDisplay } from "@/components/ui/rich-text-display";

interface Revision {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; avatarUrl: string | null };
}

interface VersionHistoryPanelProps {
  revisions: Revision[];
  projectKey: string;
  pageId: string;
  onRestore: (content: string) => void;
  onClose: () => void;
}

function formatRevisionDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function VersionHistoryPanel({
  revisions,
  projectKey,
  pageId,
  onRestore,
  onClose,
}: VersionHistoryPanelProps) {
  const [previewing, setPreviewing] = useState<Revision | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function handleRestore(revision: Revision) {
    setRestoring(revision.id);
    try {
      const res = await fetch(`/api/docs/${projectKey}/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: revision.content }),
      });
      if (!res.ok) throw new Error("Restore failed");
      onRestore(revision.content);
      onClose();
    } catch {
      setRestoring(null);
    }
  }

  if (previewing) {
    return (
      <div className="w-80 flex-shrink-0 border-l border-zinc-200 dark:border-zinc-800 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setPreviewing(null)}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            ← Back
          </button>
          <span className="text-xs text-zinc-500">{formatRevisionDate(previewing.createdAt)}</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-xs text-zinc-400 mb-3">By {previewing.author.name}</div>
          <RichTextDisplay content={previewing.content} />
        </div>
        <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => handleRestore(previewing)}
            disabled={!!restoring}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restore this version
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-72 flex-shrink-0 border-l border-zinc-200 dark:border-zinc-800 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Version History</span>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
        {/* Current version */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Current version</p>
              <p className="text-xs text-zinc-400 mt-0.5 truncate">Unsaved changes may differ</p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex-shrink-0">
              Current
            </span>
          </div>
        </div>

        {revisions.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-zinc-400">No saved versions yet.</p>
            <p className="text-xs text-zinc-400 mt-1">Save the page to create a version.</p>
          </div>
        ) : (
          revisions.map((rev) => (
            <div key={rev.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                    {rev.author.name}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">{formatRevisionDate(rev.createdAt)}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setPreviewing(rev)}
                    title="Preview this version"
                    className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleRestore(rev)}
                    disabled={!!restoring}
                    title="Restore this version"
                    className="p-1 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 rounded disabled:opacity-40"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${restoring === rev.id ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
