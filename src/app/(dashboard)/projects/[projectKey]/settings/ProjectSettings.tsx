"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ProjectMemberRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { Trash2, UserPlus, Search, UserRoundPlus } from "lucide-react";
import {
  updateProject,
  addProjectMember,
  removeProjectMember,
  changeMemberRole,
  deleteProject,
  searchUsers,
  createUserAndAddToProject,
} from "../actions";

type Member = {
  id: string;
  userId: string;
  role: ProjectMemberRole;
  user: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
  };
};

type SearchedUser = {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
};

interface ProjectSettingsProps {
  project: {
    id: string;
    name: string;
    key: string;
    description: string | null;
    createdAt: string;
  };
  members: Member[];
  currentUserId: string;
  currentUserRole: ProjectMemberRole;
  ownerName: string;
  projectKey: string;
}

const roleColors: Record<string, string> = {
  OWNER: "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30",
  ADMIN: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
  MEMBER: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
  VIEWER: "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30",
};

const selectStyles =
  "h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500";

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ProjectSettings({
  project,
  members,
  currentUserId,
  currentUserRole,
  ownerName,
  projectKey,
}: ProjectSettingsProps) {
  const [activeTab, setActiveTab] = useState("general");

  const tabs = [
    { id: "general", label: "General" },
    { id: "members", label: "Members" },
    ...(currentUserRole === "OWNER"
      ? [{ id: "danger", label: "Danger Zone" }]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Tab navigation */}
      <nav className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              activeTab === tab.id
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      {activeTab === "general" && (
        <GeneralTab
          project={project}
          ownerName={ownerName}
          projectKey={projectKey}
        />
      )}
      {activeTab === "members" && (
        <MembersTab
          members={members}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          projectKey={projectKey}
        />
      )}
      {activeTab === "danger" && currentUserRole === "OWNER" && (
        <DangerZoneTab project={project} projectKey={projectKey} />
      )}
    </div>
  );
}

// =============================================================================
// General Tab
// =============================================================================

function GeneralTab({
  project,
  ownerName,
  projectKey,
}: {
  project: ProjectSettingsProps["project"];
  ownerName: string;
  projectKey: string;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Project name is required");
      return;
    }
    setSaving(true);
    try {
      await updateProject(projectKey, {
        name: name.trim(),
        description: description.trim() || null,
      });
      toast.success("Project settings saved");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save settings"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Project name
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Project key</label>
        <div className="px-3 py-2 bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-300/50 dark:border-zinc-700/50 rounded-lg text-sm text-zinc-500 dark:text-zinc-400 font-mono">
          {project.key}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-zinc-500">Created</p>
          <p className="text-zinc-700 dark:text-zinc-300">
            {new Date(project.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div>
          <p className="text-zinc-500">Owner</p>
          <p className="text-zinc-700 dark:text-zinc-300">{ownerName}</p>
        </div>
      </div>

      <Button
        onClick={handleSave}
        disabled={saving}
        className="bg-indigo-600 hover:bg-indigo-500 text-white"
      >
        {saving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  );
}

// =============================================================================
// Members Tab
// =============================================================================

function MembersTab({
  members,
  currentUserId,
  currentUserRole,
  projectKey,
}: {
  members: Member[];
  currentUserId: string;
  currentUserRole: ProjectMemberRole;
  projectKey: string;
}) {
  const router = useRouter();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);
  const [changingRoleId, setChangingRoleId] = useState<string | null>(null);

  async function handleRoleChange(
    membershipId: string,
    newRole: ProjectMemberRole
  ) {
    setChangingRoleId(membershipId);
    try {
      await changeMemberRole(projectKey, membershipId, newRole);
      toast.success("Role updated");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to change role"
      );
    } finally {
      setChangingRoleId(null);
    }
  }

  async function handleRemoveMember() {
    if (!memberToRemove) return;
    setRemovingId(memberToRemove.id);
    try {
      await removeProjectMember(projectKey, memberToRemove.id);
      toast.success("Member removed");
      setMemberToRemove(null);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove member"
      );
    } finally {
      setRemovingId(null);
    }
  }

  const canManage =
    currentUserRole === "OWNER" || currentUserRole === "ADMIN";

  return (
    <div className="space-y-8">
      {/* Members list */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Project members ({members.length})
        </h3>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          {members.map((member) => {
            const isOwner = member.role === "OWNER";
            const isSelf = member.userId === currentUserId;

            return (
              <div
                key={member.id}
                className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-zinc-900"
              >
                <Avatar size="default">
                  {member.user.avatarUrl && (
                    <AvatarImage src={member.user.avatarUrl} />
                  )}
                  <AvatarFallback>
                    {getInitials(member.user.name)}
                  </AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {member.user.name ?? "Unnamed"}
                    {isSelf && (
                      <span className="text-zinc-500 ml-1">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-500 truncate">
                    {member.user.email}
                  </p>
                </div>

                {/* Role badge or selector */}
                {canManage && !isOwner ? (
                  <select
                    value={member.role}
                    onChange={(e) =>
                      handleRoleChange(
                        member.id,
                        e.target.value as ProjectMemberRole
                      )
                    }
                    disabled={changingRoleId === member.id}
                    className={selectStyles}
                  >
                    <option value="ADMIN">Admin</option>
                    <option value="MEMBER">Member</option>
                    <option value="VIEWER">Viewer</option>
                  </select>
                ) : (
                  <span
                    className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium",
                      roleColors[member.role]
                    )}
                  >
                    {member.role}
                  </span>
                )}

                {/* Remove button */}
                {canManage && !isOwner && !isSelf && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setMemberToRemove(member)}
                    className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add member section */}
      {canManage && (
        <AddMemberSection projectKey={projectKey} />
      )}

      {/* Remove member confirmation dialog */}
      <Dialog
        open={!!memberToRemove}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null);
        }}
      >
        <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-zinc-900 dark:text-zinc-100">Remove member</DialogTitle>
            <DialogDescription className="text-zinc-600 dark:text-zinc-400">
              Are you sure you want to remove{" "}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {memberToRemove?.user.name ?? memberToRemove?.user.email}
              </span>{" "}
              from this project?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setMemberToRemove(null)}
              className="border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveMember}
              disabled={removingId === memberToRemove?.id}
            >
              {removingId === memberToRemove?.id ? "Removing..." : "Remove"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// =============================================================================
// Add Member Section
// =============================================================================

function AddMemberSection({ projectKey }: { projectKey: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"search" | "create">("search");

  // Search mode state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchedUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SearchedUser | null>(null);
  const [addRole, setAddRole] = useState<ProjectMemberRole>("MEMBER");
  const [adding, setAdding] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create mode state
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [createRole, setCreateRole] = useState<ProjectMemberRole>("MEMBER");
  const [creating, setCreating] = useState(false);

  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      setSelectedUser(null);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!query.trim()) {
        setSearchResults([]);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        setSearching(true);
        try {
          const results = await searchUsers(query, projectKey);
          setSearchResults(results);
        } catch {
          setSearchResults([]);
        } finally {
          setSearching(false);
        }
      }, 300);
    },
    [projectKey]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  async function handleAddMember() {
    if (!selectedUser) return;
    setAdding(true);
    try {
      await addProjectMember(projectKey, selectedUser.id, addRole);
      toast.success(`${selectedUser.name ?? selectedUser.email} added to project`);
      setSelectedUser(null);
      setSearchQuery("");
      setSearchResults([]);
      setAddRole("MEMBER");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add member"
      );
    } finally {
      setAdding(false);
    }
  }

  async function handleCreateAndAdd() {
    if (!newName.trim() || !newEmail.trim() || !newPassword.trim()) {
      toast.error("All fields are required");
      return;
    }
    setCreating(true);
    try {
      await createUserAndAddToProject(projectKey, {
        name: newName.trim(),
        email: newEmail.trim(),
        password: newPassword,
        role: createRole,
      });
      toast.success(`${newName.trim()} created and added to project`);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setCreateRole("MEMBER");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create user"
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Add member</h3>
        <button
          onClick={() => setMode(mode === "search" ? "create" : "search")}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          {mode === "search"
            ? "Or create a new user"
            : "Or search existing users"}
        </button>
      </div>

      {mode === "search" ? (
        <div className="space-y-3">
          {/* Search input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
            <Input
              placeholder="Search users by email..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 pl-9"
            />
          </div>

          {/* Search results dropdown */}
          {searchQuery.trim() && !selectedUser && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              {searching ? (
                <div className="px-4 py-3 text-sm text-zinc-500">
                  Searching...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="px-4 py-3 text-sm text-zinc-500">
                  No users found
                </div>
              ) : (
                searchResults.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => setSelectedUser(user)}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <Avatar size="sm">
                      {user.avatarUrl && (
                        <AvatarImage src={user.avatarUrl} />
                      )}
                      <AvatarFallback>
                        {getInitials(user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-800 dark:text-zinc-200 truncate">
                        {user.name ?? "Unnamed"}
                      </p>
                      <p className="text-xs text-zinc-500 truncate">
                        {user.email}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Selected user */}
          {selectedUser && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <Avatar size="sm">
                {selectedUser.avatarUrl && (
                  <AvatarImage src={selectedUser.avatarUrl} />
                )}
                <AvatarFallback>
                  {getInitials(selectedUser.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-800 dark:text-zinc-200 truncate">
                  {selectedUser.name ?? "Unnamed"}
                </p>
                <p className="text-xs text-zinc-500 truncate">
                  {selectedUser.email}
                </p>
              </div>
              <select
                value={addRole}
                onChange={(e) =>
                  setAddRole(e.target.value as ProjectMemberRole)
                }
                className={selectStyles}
              >
                <option value="ADMIN">Admin</option>
                <option value="MEMBER">Member</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <Button
                onClick={handleAddMember}
                disabled={adding}
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
                size="sm"
              >
                <UserPlus className="size-3.5 mr-1" />
                {adding ? "Adding..." : "Add"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        /* Create user mode */
        <div className="space-y-3 max-w-md">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Full name"
              className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
            <Input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="user@example.com"
              className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Password
            </label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Temporary password"
              className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Role</label>
            <select
              value={createRole}
              onChange={(e) =>
                setCreateRole(e.target.value as ProjectMemberRole)
              }
              className={cn(selectStyles, "w-full")}
            >
              <option value="ADMIN">Admin</option>
              <option value="MEMBER">Member</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </div>
          <Button
            onClick={handleCreateAndAdd}
            disabled={creating}
            className="bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            <UserRoundPlus className="size-4 mr-1.5" />
            {creating ? "Creating..." : "Create & Add"}
          </Button>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Danger Zone Tab
// =============================================================================

function DangerZoneTab({
  project,
  projectKey,
}: {
  project: ProjectSettingsProps["project"];
  projectKey: string;
}) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteProject(projectKey);
      // deleteProject calls redirect() on the server side
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete project"
      );
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-xl">
      <div className="border border-red-500/30 rounded-xl p-6 bg-red-500/5">
        <h3 className="text-lg font-semibold text-red-400 mb-2">
          Delete Project
        </h3>
        <p className="text-sm text-zinc-400 mb-4">
          Once you delete a project, there is no going back. This will
          permanently delete the project and all associated data including
          issues, comments, activity logs, and member associations.
        </p>
        <Button
          variant="destructive"
          onClick={() => setShowDeleteDialog(true)}
        >
          Delete this project
        </Button>
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-zinc-900 dark:text-zinc-100">
              Delete project {project.key}?
            </DialogTitle>
            <DialogDescription className="text-zinc-600 dark:text-zinc-400">
              This action cannot be undone. All issues, comments, and data will
              be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-sm text-zinc-700 dark:text-zinc-300">
                Type <span className="font-bold text-zinc-900 dark:text-zinc-100">{project.key}</span> to
                confirm
              </label>
              <Input
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder={project.key}
                className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteDialog(false);
                  setConfirmInput("");
                }}
                className="border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={confirmInput !== project.key || deleting}
              >
                {deleting ? "Deleting..." : "Delete project"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
