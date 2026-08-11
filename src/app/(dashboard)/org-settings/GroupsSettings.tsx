"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Users, X } from "lucide-react";
import type { Permission } from "@prisma/client";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  listGroups,
  getOrgProjectsForGroups,
  searchOrgMembersForGroup,
  createGroup,
  renameGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
  setGroupPermission,
  removeGroupPermission,
  type GroupRow,
} from "./group-actions";

// ─── Constants ────────────────────────────────────────────────────────────────

type OrgProject = { id: string; name: string; key: string };

const PROJECT_SCOPED_PERMISSIONS: Permission[] = [
  "PROJECT_DELETE",
  "PROJECT_EDIT_SETTINGS",
  "PROJECT_MANAGE_MEMBERS",
  "ISSUE_EDIT",
];
const ORG_SCOPED_PERMISSIONS: Permission[] = ["ORG_MANAGE_CUSTOM_FIELDS", "ORG_MANAGE_API_KEYS"];

const PERMISSION_LABELS: Record<Permission, string> = {
  PROJECT_DELETE: "Delete project",
  PROJECT_EDIT_SETTINGS: "Edit project settings",
  PROJECT_MANAGE_MEMBERS: "Manage project members",
  ISSUE_EDIT: "Edit issues",
  ORG_MANAGE_CUSTOM_FIELDS: "Manage custom fields",
  ORG_MANAGE_API_KEYS: "Manage API keys",
};

// ─── Group Name Dialog (create / rename) ───────────────────────────────────────

function GroupNameDialog({
  open,
  onOpenChange,
  orgId,
  group,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  group: GroupRow | null;
  onSaved: () => void;
}) {
  const isEdit = group !== null;
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(group?.name ?? "");
  }, [open, group]);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const result = isEdit
        ? await renameGroup(orgId, group.id, name)
        : await createGroup(orgId, name);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(isEdit ? "Group renamed" : "Group created");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Failed to save group");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Rename group" : "Create group"}</DialogTitle>
          <DialogDescription>
            Groups grant extra permissions to specific people on top of their existing role —
            they never grant access to a project someone isn&apos;t already a member of.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Group name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.repeat && name.trim()) handleSubmit();
            }}
            placeholder="e.g. QA Leads, Contractors"
            className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
          >
            {saving ? "Saving..." : isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Group Detail Dialog (members + permissions) ───────────────────────────────

function GroupDetailDialog({
  open,
  onOpenChange,
  orgId,
  group,
  projects,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  group: GroupRow | null;
  projects: OrgProject[];
  onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; email: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !group || !query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timeout = setTimeout(async () => {
      try {
        const data = await searchOrgMembersForGroup(orgId, group.id, query);
        if (!cancelled) setResults(data);
      } catch {
        if (!cancelled) toast.error("Search failed");
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [open, group, orgId, query]);

  if (!group) return null;

  async function handleAddMember(userId: string) {
    if (!group) return;
    setBusy(true);
    try {
      const result = await addGroupMember(orgId, group.id, userId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setQuery("");
      setResults([]);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!group) return;
    setBusy(true);
    try {
      const result = await removeGroupMember(orgId, group.id, userId);
      if (!result.success) toast.error(result.error);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleOrgWide(permission: Permission, grantId: string | null) {
    if (!group) return;
    setBusy(true);
    try {
      const result = grantId
        ? await removeGroupPermission(orgId, grantId)
        : await setGroupPermission(orgId, group.id, permission, null);
      if (!result.success) toast.error(result.error);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleProject(permission: Permission, projectId: string, grantId: string | null) {
    if (!group) return;
    setBusy(true);
    try {
      const result = grantId
        ? await removeGroupPermission(orgId, grantId)
        : await setGroupPermission(orgId, group.id, permission, projectId);
      if (!result.success) toast.error(result.error);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{group.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Members */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Members</h4>
            {group.members.length === 0 ? (
              <p className="text-xs text-zinc-500">No members yet.</p>
            ) : (
              <div className="space-y-1">
                {group.members.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-900 dark:text-zinc-100 truncate">{m.name}</p>
                      <p className="text-xs text-zinc-500 truncate">{m.email}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveMember(m.userId)}
                      disabled={busy}
                      className="p-1 text-zinc-400 hover:text-red-400 transition-colors flex-shrink-0"
                      title="Remove from group"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Add an organization member by name or email..."
                className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
              />
              {query.trim() && (
                <div className="mt-1 rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 max-h-40 overflow-y-auto">
                  {searching ? (
                    <p className="px-3 py-2 text-xs text-zinc-500">Searching...</p>
                  ) : results.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-zinc-500">No matching org members</p>
                  ) : (
                    results.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => handleAddMember(u.id)}
                        disabled={busy}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <span className="text-zinc-900 dark:text-zinc-100">{u.name}</span>{" "}
                        <span className="text-zinc-500 text-xs">{u.email}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Permissions */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Permissions</h4>

            {ORG_SCOPED_PERMISSIONS.map((permission) => {
              const grant = group.grants.find((g) => g.permission === permission);
              return (
                <label
                  key={permission}
                  className="flex items-center gap-2.5 cursor-pointer rounded-md px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <input
                    type="checkbox"
                    checked={!!grant}
                    disabled={busy}
                    onChange={() => handleToggleOrgWide(permission, grant?.id ?? null)}
                    className="accent-primary"
                  />
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">
                    {PERMISSION_LABELS[permission]}
                  </span>
                  <span className="text-xs text-zinc-500 ml-auto">Org-wide</span>
                </label>
              );
            })}

            {PROJECT_SCOPED_PERMISSIONS.map((permission) => {
              const orgWideGrant = group.grants.find(
                (g) => g.permission === permission && g.projectId === null
              );
              const projectGrants = group.grants.filter(
                (g) => g.permission === permission && g.projectId !== null
              );
              return (
                <div key={permission} className="space-y-1 rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!orgWideGrant}
                      disabled={busy}
                      onChange={() => handleToggleOrgWide(permission, orgWideGrant?.id ?? null)}
                      className="accent-primary"
                    />
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">
                      {PERMISSION_LABELS[permission]}
                    </span>
                    <span className="text-xs text-zinc-500 ml-auto">All projects</span>
                  </label>

                  {!orgWideGrant && projects.length > 0 && (
                    <div className="pl-6 space-y-1">
                      {projects.map((project) => {
                        const projectGrant = projectGrants.find((g) => g.projectId === project.id);
                        return (
                          <label
                            key={project.id}
                            className="flex items-center gap-2.5 cursor-pointer rounded-md px-1 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <input
                              type="checkbox"
                              checked={!!projectGrant}
                              disabled={busy}
                              onChange={() =>
                                handleToggleProject(permission, project.id, projectGrant?.id ?? null)
                              }
                              className="accent-primary"
                            />
                            <span className="text-xs text-zinc-600 dark:text-zinc-400">
                              {project.name}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function GroupsSettings({ orgId }: { orgId: string }) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [projects, setProjects] = useState<OrgProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupRow | null>(null);
  const [managingGroupId, setManagingGroupId] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<GroupRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const hasFetched = useRef(false);

  async function loadData() {
    try {
      const [fetchedGroups, fetchedProjects] = await Promise.all([
        listGroups(orgId),
        getOrgProjectsForGroups(orgId),
      ]);
      setGroups(fetchedGroups);
      setProjects(fetchedProjects);
    } catch {
      toast.error("Failed to load groups");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!hasFetched.current) {
      hasFetched.current = true;
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete() {
    if (!deletingGroup) return;
    setDeleting(true);
    try {
      const result = await deleteGroup(orgId, deletingGroup.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Group deleted");
      setDeletingGroup(null);
      await loadData();
    } finally {
      setDeleting(false);
    }
  }

  const managingGroup = groups.find((g) => g.id === managingGroupId) ?? null;

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2].map((i) => (
          <div key={i} className="h-16 bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Groups</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Grant specific people extra permissions without changing their role. A group can
            only boost someone who&apos;s already a member — it never grants new access on its own.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingGroup(null);
            setNameDialogOpen(true);
          }}
          size="sm"
          className="flex-shrink-0"
        >
          <Plus className="size-3.5 mr-1" />
          New group
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No groups yet</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-1">
            Create a group to grant extra permissions to specific people.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-900"
            >
              <div className="flex-1 min-w-0 space-y-0.5">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {group.name}
                </span>
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                  <span>
                    {group.members.length} member{group.members.length === 1 ? "" : "s"}
                  </span>
                  <span>
                    {group.grants.length} grant{group.grants.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setManagingGroupId(group.id)}
                  className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  <Users className="size-3.5 mr-1" />
                  Manage
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setEditingGroup(group);
                    setNameDialogOpen(true);
                  }}
                  className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  title="Rename group"
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setDeletingGroup(group)}
                  className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                  title="Delete group"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <GroupNameDialog
        open={nameDialogOpen}
        onOpenChange={setNameDialogOpen}
        orgId={orgId}
        group={editingGroup}
        onSaved={loadData}
      />

      <GroupDetailDialog
        open={!!managingGroupId}
        onOpenChange={(open) => {
          if (!open) setManagingGroupId(null);
        }}
        orgId={orgId}
        group={managingGroup}
        projects={projects}
        onChanged={loadData}
      />

      <ConfirmDialog
        open={!!deletingGroup}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeletingGroup(null);
        }}
        title={`Delete "${deletingGroup?.name}"?`}
        description="Members lose any permissions this group granted them. This action cannot be undone."
        confirmLabel={deleting ? "Deleting..." : "Delete"}
        onConfirm={handleDelete}
      />
    </div>
  );
}
