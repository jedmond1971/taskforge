"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Upload, FileText, AlertCircle, Loader2 } from "lucide-react";
import { ReferencedIssuesPanel } from "@/components/docs/referenced-issues-panel";

interface DocDocumentViewProps {
  page: {
    id: string;
    title: string;
    mimeType: string | null;
    fileSize: number | null;
    updatedAt: string;
    author: { id: string; name: string; avatarUrl: string | null };
  };
  projectKey: string;
  readOnly?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdf(mimeType: string | null): boolean {
  return mimeType === "application/pdf";
}

export function DocDocumentView({ page, projectKey, readOnly = false }: DocDocumentViewProps) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/docs/${projectKey}/pages/${page.id}/file`)
      .then((r) => r.json())
      .then((data: { url?: string; error?: string }) => {
        if (cancelled) return;
        if (data.url) {
          setFileUrl(data.url);
        } else {
          setError(data.error ?? "Failed to load file");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load file");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectKey, page.id]);

  async function handleReplace(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReplacing(true);
    setReplaceError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/docs/${projectKey}/pages/${page.id}/file`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Upload failed");
      }
      // Reload page to get fresh presigned URL
      window.location.reload();
    } catch (err) {
      setReplaceError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setReplacing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

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
          {replaceError && (
            <span className="text-xs text-red-500">{replaceError}</span>
          )}
          {!readOnly && (
            <label className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer ${replacing ? "opacity-50 pointer-events-none" : ""}`}>
              {replacing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{replacing ? "Uploading…" : "Replace"}</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="sr-only"
                onChange={handleReplace}
                disabled={replacing}
              />
            </label>
          )}
          {fileUrl && (
            <a
              href={fileUrl}
              download={page.title}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <FileText className="w-6 h-6 text-zinc-400 flex-shrink-0" />
          {page.title}
        </h1>
        <div className="flex items-center gap-3 mt-1 text-xs text-zinc-400">
          {page.mimeType === "application/pdf" ? "PDF" : "Word Document"}
          {page.fileSize !== null && <span>· {formatBytes(page.fileSize)}</span>}
          <span>· Updated {new Date(page.updatedAt).toLocaleDateString()} by {page.author.name}</span>
        </div>
      </div>

      {/* Referenced issues */}
      <ReferencedIssuesPanel projectKey={projectKey} pageId={page.id} />

      {/* Viewer area */}
      <div className="flex-1 min-h-0 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center h-64 gap-2 text-zinc-400">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading document…</span>
          </div>
        )}
        {error && !loading && (
          <div className="flex items-center justify-center h-64 gap-2 text-zinc-400">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">{error}</span>
          </div>
        )}
        {fileUrl && !loading && (
          isPdf(page.mimeType) ? (
            <iframe
              src={fileUrl}
              className="w-full h-full min-h-[600px]"
              title={page.title}
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 py-20 text-center px-6">
              <FileText className="w-16 h-16 text-zinc-300 dark:text-zinc-600" />
              <div>
                <p className="text-base font-semibold text-zinc-700 dark:text-zinc-300">
                  {page.title}
                </p>
                <p className="text-sm text-zinc-400 mt-1">
                  Word documents can&apos;t be previewed in the browser. Use the Download button to open it.
                </p>
              </div>
              {fileUrl && (
                <a
                  href={fileUrl}
                  download={page.title}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download {page.mimeType === "application/pdf" ? "PDF" : "Document"}
                </a>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
