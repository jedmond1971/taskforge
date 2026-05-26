"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Edit2, Save, X, History, Check } from "lucide-react";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { RichTextDisplay } from "@/components/ui/rich-text-display";
import { VersionHistoryPanel } from "@/components/docs/version-history-panel";
import { ReferencedIssuesPanel } from "@/components/docs/referenced-issues-panel";

interface Revision {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; avatarUrl: string | null };
}

interface DocPage {
  id: string;
  title: string;
  content: string | null;
  updatedAt: string;
  author: { id: string; name: string; avatarUrl: string | null };
}

interface DocPageEditorProps {
  page: DocPage;
  initialRevisions: Revision[];
  projectKey: string;
  projectName: string;
  readOnly?: boolean;
}

export function DocPageEditor({ page, initialRevisions, projectKey, readOnly = false }: DocPageEditorProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [title, setTitle] = useState(page.title);
  const [content, setContent] = useState(page.content ?? "");
  const [savedTitle, setSavedTitle] = useState(page.title);
  const [savedContent, setSavedContent] = useState(page.content ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>(initialRevisions);
  const [editorKey, setEditorKey] = useState(0);

  const isDirty = title !== savedTitle || content !== savedContent;

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/docs/${projectKey}/pages/${page.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSavedTitle(title.trim());
      setSavedContent(content);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);

      // Refresh revisions list after save
      const revRes = await fetch(`/api/docs/${projectKey}/pages/${page.id}/revisions`);
      if (revRes.ok) {
        const revData = await revRes.json() as { revisions: Revision[] };
        setRevisions(revData.revisions);
      }

      router.refresh();
    } catch {
      setSaveError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setTitle(savedTitle);
    setContent(savedContent);
    setMode("view");
    setSaveError(null);
  }

  const handleRestore = useCallback((restoredContent: string) => {
    setContent(restoredContent);
    setSavedContent(restoredContent);
    setEditorKey((k) => k + 1);
    setMode("edit");
    router.refresh();
  }, [router]);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <Link
          href={`/projects/${projectKey}/docs`}
          className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Docs</span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            title="Version history"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
              historyOpen
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                : "text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">History</span>
          </button>

          {mode === "view" && !readOnly ? (
            <button
              onClick={() => setMode("edit")}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Edit
            </button>
          ) : mode === "edit" ? (
            <div className="flex items-center gap-2">
              {saveError && (
                <span className="text-xs text-red-500">{saveError}</span>
              )}
              {saveSuccess && (
                <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <Check className="w-3 h-3" />
                  Saved
                </span>
              )}
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Main content area + optional history panel */}
      <div className="flex gap-0 flex-1 min-h-0">
        <div className="flex-1 min-w-0">
          {mode === "edit" ? (
            <div className="space-y-4">
              {/* Editable title */}
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-2xl font-bold text-zinc-900 dark:text-zinc-100 bg-transparent border-0 outline-none focus:ring-0 p-0 placeholder-zinc-300 dark:placeholder-zinc-700"
                placeholder="Page title"
              />
              <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                <RichTextEditor
                  key={editorKey}
                  value={content}
                  onChange={setContent}
                  placeholder="Start writing…"
                  minHeight="400px"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{savedTitle}</h1>
              <div className="border-t border-zinc-100 dark:border-zinc-800 pt-4">
                {savedContent ? (
                  <RichTextDisplay content={savedContent} />
                ) : (
                  <p className="text-sm text-zinc-400 dark:text-zinc-600 italic">
                    No content yet.{" "}
                    <button
                      onClick={() => setMode("edit")}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Click Edit to start writing.
                    </button>
                  </p>
                )}
              </div>
              <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-xs text-zinc-400">
                  Last updated {new Date(page.updatedAt).toLocaleDateString()} by {page.author.name}
                </p>
              </div>
              <ReferencedIssuesPanel projectKey={projectKey} pageId={page.id} />
            </div>
          )}
        </div>

        {historyOpen && (
          <VersionHistoryPanel
            revisions={revisions}
            projectKey={projectKey}
            pageId={page.id}
            onRestore={handleRestore}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
