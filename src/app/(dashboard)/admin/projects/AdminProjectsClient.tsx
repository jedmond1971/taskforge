"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Search, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { getAdminProjects, adminDeleteProject } from "../actions";

type AdminProject = {
  id: string;
  name: string;
  key: string;
  createdAt: Date;
  _count: { members: number; issues: number };
  members: { user: { name: string } }[];
};

export function AdminProjectsClient({
  initialProjects,
}: {
  initialProjects: AdminProject[];
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<AdminProject[]>(initialProjects);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  // Delete state
  const [deleteProject, setDeleteProject] = useState<AdminProject | null>(null);
  const [confirmKey, setConfirmKey] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Debounced search
  useEffect(() => {
    const timeout = setTimeout(() => {
      startTransition(async () => {
        try {
          const result = await getAdminProjects(search || undefined);
          setProjects(result);
        } catch {
          // ignore search errors
        }
      });
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  // Update projects when initialProjects change
  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  const handleDelete = async () => {
    if (!deleteProject || confirmKey !== deleteProject.key) return;
    setDeleting(true);
    try {
      await adminDeleteProject(deleteProject.id);
      toast.success("Project deleted successfully");
      setDeleteProject(null);
      setConfirmKey("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete project");
    } finally {
      setDeleting(false);
    }
  };

  const openDelete = (project: AdminProject) => {
    setDeleteProject(project);
    setConfirmKey("");
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm dark:shadow-none">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Project
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Owner
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Members
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Issues
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Created
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {projects.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500 text-sm">
                  No projects found.
                </td>
              </tr>
            ) : (
              projects.map((project) => (
                <tr key={project.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{project.name}</p>
                      <p className="text-xs text-zinc-500">{project.key}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">
                    {project.members[0]?.user.name ?? "No owner"}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">
                    {project._count.members}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">
                    {project._count.issues}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500">
                    {new Date(project.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" render={<Link href={`/projects/${project.key}`} />}>
                        <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openDelete(project)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Delete Project Dialog */}
      <Dialog open={!!deleteProject} onOpenChange={(open) => !open && setDeleteProject(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the project and all
              associated data including issues, boards, and comments.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Type <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">{deleteProject?.key}</span> to
              confirm deletion.
            </p>
            <Input
              placeholder={deleteProject?.key}
              value={confirmKey}
              onChange={(e) => setConfirmKey(e.target.value)}
              className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteProject(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || confirmKey !== deleteProject?.key}
            >
              {deleting ? "Deleting..." : "Delete Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
