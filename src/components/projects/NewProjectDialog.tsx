"use client";

import { useState, cloneElement, isValidElement } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";

interface NewProjectDialogProps {
  trigger?: React.ReactElement<{ onClick?: React.MouseEventHandler }>;
}

export function NewProjectDialog({ trigger }: NewProjectDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const name = formData.get("name") as string;
    const key = (formData.get("key") as string).toUpperCase();
    const description = formData.get("description") as string;

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, key, description }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create project");
      } else {
        setOpen(false);
        router.push(`/projects/${data.project.key}`);
        router.refresh();
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const triggerEl = isValidElement(trigger)
    ? cloneElement(trigger, { onClick: () => setOpen(true) })
    : (
      <Button
        size="sm"
        className="bg-indigo-600 hover:bg-indigo-500 text-white gap-1.5"
        onClick={() => setOpen(true)}
      >
        <Plus className="w-4 h-4" />
        New Project
      </Button>
    );

  return (
    <>
      {triggerEl}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-zinc-900 dark:text-zinc-100">Create New Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="name" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Project name
            </label>
            <Input
              id="name"
              name="name"
              required
              placeholder="My Awesome Project"
              className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              onChange={(e) => {
                const keyInput = e.currentTarget.form?.querySelector<HTMLInputElement>('[name="key"]');
                if (keyInput && !keyInput.dataset.touched) {
                  keyInput.value = e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, "")
                    .slice(0, 6);
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="key" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Project key <span className="text-zinc-500 font-normal">(unique identifier)</span>
            </label>
            <Input
              id="key"
              name="key"
              required
              placeholder="MAP"
              maxLength={6}
              className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 uppercase"
              onInput={(e) => {
                e.currentTarget.value = e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                e.currentTarget.dataset.touched = "true";
              }}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="description" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Description <span className="text-zinc-500 font-normal">(optional)</span>
            </label>
            <Input
              id="description"
              name="description"
              placeholder="What is this project about?"
              className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              {loading ? "Creating..." : "Create Project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}
