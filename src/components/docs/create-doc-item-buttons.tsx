"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, FileText, FolderOpen } from "lucide-react";
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

  if (variant === "icon-only") {
    return (
      <>
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

      <PageDialog
        open={pageDialogOpen}
        onOpenChange={(o) => { setPageDialogOpen(o); if (!o) setError(null); }}
        title={pageTitle}
        onTitleChange={setPageTitle}
        onSubmit={handleCreatePage}
        creating={creating}
        error={error}
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
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  onTitleChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  creating: boolean;
  error: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Page</DialogTitle>
          <DialogDescription>Give your page a title. You can edit the content after creating it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <div className="py-3">
            <Input
              autoFocus
              placeholder="Page title"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              maxLength={200}
            />
            {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
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
