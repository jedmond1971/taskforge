"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Plus, FileText, FolderOpen, Upload, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface CreateDocItemButtonsProps {
  projectKey: string;
  variant?: "full" | "icon-only";
}

export function CreateDocItemButtons({ projectKey, variant = "full" }: CreateDocItemButtonsProps) {
  const router = useRouter();
  const [pageDialogOpen, setPageDialogOpen] = useState(false);
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleCreatePage(e: React.FormEvent) {
    e.preventDefault();
    if (!pageTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/docs/${projectKey}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: pageTitle.trim(), type: "NATIVE" }),
      });
      if (!res.ok) throw new Error("Failed to create page");
      const data = await res.json() as { page: { id: string } };
      setPageDialogOpen(false);
      setPageTitle("");
      router.push(`/projects/${projectKey}/docs/${data.page.id}`);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateSection(e: React.FormEvent) {
    e.preventDefault();
    if (!sectionTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/docs/${projectKey}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: sectionTitle.trim() }),
      });
      if (!res.ok) throw new Error("Failed to create section");
      setSectionDialogOpen(false);
      setSectionTitle("");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDocumentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);

    // Derive a page title from the filename (strip extension)
    const baseName = file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");

    try {
      // 1. Create the DOCUMENT page stub
      const createRes = await fetch(`/api/docs/${projectKey}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: baseName || file.name, type: "DOCUMENT" }),
      });
      if (!createRes.ok) throw new Error("Failed to create page");
      const { page } = await createRes.json() as { page: { id: string } };

      // 2. Upload the file
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch(`/api/docs/${projectKey}/pages/${page.id}/file`, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) {
        const data = await uploadRes.json() as { error?: string };
        throw new Error(data.error ?? "Upload failed");
      }

      router.push(`/projects/${projectKey}/docs/${page.id}`);
      router.refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (variant === "icon-only") {
    return (
      <>
        {uploadError && (
          <span className="text-xs text-red-500">{uploadError}</span>
        )}
        <button
          onClick={() => { setError(null); setPageDialogOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New
        </button>

        <PageDialog
          open={pageDialogOpen}
          onOpenChange={(o) => { setPageDialogOpen(o); if (!o) setError(null); }}
          title={pageTitle}
          onTitleChange={setPageTitle}
          onSubmit={handleCreatePage}
          creating={creating}
          error={error}
          onUploadDocument={() => fileInputRef.current?.click()}
          uploading={uploading}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="sr-only"
          onChange={handleDocumentUpload}
          disabled={uploading}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setError(null); setSectionDialogOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <FolderOpen className="w-4 h-4" />
          New Section
        </button>
        <button
          onClick={() => { setError(null); setPageDialogOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          <FileText className="w-4 h-4" />
          New Page
        </button>
      </div>
      {uploadError && (
        <p className="text-xs text-red-500 mt-1">{uploadError}</p>
      )}

      <PageDialog
        open={pageDialogOpen}
        onOpenChange={(o) => { setPageDialogOpen(o); if (!o) setError(null); }}
        title={pageTitle}
        onTitleChange={setPageTitle}
        onSubmit={handleCreatePage}
        creating={creating}
        error={error}
        onUploadDocument={() => fileInputRef.current?.click()}
        uploading={uploading}
      />

      <Dialog open={sectionDialogOpen} onOpenChange={(o) => { setSectionDialogOpen(o); if (!o) setError(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Section</DialogTitle>
            <DialogDescription>Give this section a name. You can add pages to it afterward.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSection}>
            <div className="py-3">
              <Input
                autoFocus
                placeholder="Section name"
                value={sectionTitle}
                onChange={(e) => setSectionTitle(e.target.value)}
                maxLength={100}
              />
              {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setSectionDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !sectionTitle.trim()}>
                {creating ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        onChange={handleDocumentUpload}
        disabled={uploading}
      />
    </>
  );
}

function PageDialog({
  open,
  onOpenChange,
  title,
  onTitleChange,
  onSubmit,
  creating,
  error,
  onUploadDocument,
  uploading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  onTitleChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  creating: boolean;
  error: string | null;
  onUploadDocument: () => void;
  uploading: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Page</DialogTitle>
          <DialogDescription>Give your page a title, or upload a PDF / Word document.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <div className="py-3 space-y-3">
            <Input
              autoFocus
              placeholder="Page title"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              maxLength={200}
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
              <span className="text-xs text-zinc-400">or</span>
              <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
            </div>
            <button
              type="button"
              onClick={() => { onOpenChange(false); onUploadDocument(); }}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm border border-dashed border-zinc-300 dark:border-zinc-600 rounded-lg text-zinc-500 dark:text-zinc-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload PDF or Word document
            </button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating || !title.trim()}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
