"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Search, ExternalLink, Trash2, Lock, Unlock, FolderKanban } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
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
import { getAdminProjects, adminDeleteProject, closeProject, reopenProject } from "../actions";

type AdminProject = {
  id: string;
  name: string;
  key: string;
  isClosed: boolean;
  createdAt: Date;
  org: { id: string; name: string };
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

  const [toggling, setToggling] = useState<string | null>(null);

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
      const result = await adminDeleteProject(deleteProject.id);
      if (!result.success) { toast.error(result.error); return; }
      toast.success("Project deleted successfully");
      setDeleteProject(null);
      setConfirmKey("");
      router.refresh();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setDeleting(false);
    }
  };

  const openDelete = (project: AdminProject) => {
    setDeleteProject(project);
    setConfirmKey("");
  };

  const handleCloseToggle = async (project: AdminProject) => {
    setToggling(project.id);
    try {
      if (project.isClosed) {
        await reopenProject(project.id);
        toast.success(`"${project.name}" reopened`);
      } else {
        await closeProject(project.id);
        toast.success(`"${project.name}" closed`);
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface shadow-[var(--shadow-panel)] rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-soft">
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Project
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Org
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Owner
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Members
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Issues
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Created
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {projects.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <EmptyState icon={FolderKanban} title="No projects found." />
                </td>
              </tr>
            ) : (
              projects.map((project) => (
                <tr key={project.id} className="hover:bg-surface-active transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/projects/${project.id}`}
                          className="text-sm font-medium text-foreground hover:underline"
                        >
                          {project.name}
                        </Link>
                        {project.isClosed && (
                          <span className="text-xs font-medium text-danger bg-danger-soft px-1.5 py-0.5 rounded">
                            Closed
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{project.key}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    <Link href={`/admin/orgs/${project.org.id}`} className="hover:underline hover:text-foreground">
                      {project.org.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {project.members[0]?.user.name ?? "No owner"}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {project._count.members}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {project._count.issues}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {new Date(project.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" render={<Link href={`/projects/${project.key}`} />}>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleCloseToggle(project)}
                        disabled={toggling === project.id}
                        title={project.isClosed ? "Reopen project" : "Close project"}
                      >
                        {project.isClosed ? (
                          <Unlock className="w-3.5 h-3.5 text-success" />
                        ) : (
                          <Lock className="w-3.5 h-3.5 text-warning" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openDelete(project)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-danger" />
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
            <p className="text-sm text-muted-foreground">
              Type <span className="font-mono font-semibold text-foreground">{deleteProject?.key}</span> to
              confirm deletion.
            </p>
            <Input
              placeholder={deleteProject?.key}
              value={confirmKey}
              onChange={(e) => setConfirmKey(e.target.value)}
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
