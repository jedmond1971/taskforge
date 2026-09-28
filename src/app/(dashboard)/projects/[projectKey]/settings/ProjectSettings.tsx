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
import { MonoMeta } from "@/components/ui/mono-meta";
import { cn } from "@/lib/utils";
import { Trash2, UserPlus, Search, UserRoundPlus } from "lucide-react";
import { BoardSettings } from "./BoardSettings";
import { CustomFieldsSettings } from "./CustomFieldsSettings";
import { ScreenLayoutSettings } from "./ScreenLayoutSettings";
import {
  updateProject,
  addProjectMember,
  removeProjectMember,
  changeMemberRole,
  deleteProject,
  setProjectPrivacy,
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
    isPrivate: boolean;
  };
  members: Member[];
  currentUserId: string;
  currentUserRole: ProjectMemberRole | null;
  ownerName: string;
  projectKey: string;
  isAdmin: boolean;
  orgId: string;
  canManageCustomFields: boolean;
  canManageMembersGrant: boolean;
}

const roleColors: Record<string, string> = {
  PROJECT_LEAD: "bg-primary/20 text-primary border border-primary/30",
  TEAM_MEMBER: "bg-success-soft text-success border border-success/20",
  VIEWER: "bg-surface-active text-muted-foreground border border-border-soft",
};

const roleLabels: Record<string, string> = {
  PROJECT_LEAD: "Project Lead",
  TEAM_MEMBER: "Team Member",
  VIEWER: "Viewer",
};

const selectStyles =
  "h-8 rounded-lg border border-border bg-surface-active px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary";

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
  isAdmin,
  orgId,
  canManageCustomFields,
  canManageMembersGrant,
}: ProjectSettingsProps) {
  const tabs = [
    ...(currentUserRole !== null
      ? [{ id: "general", label: "General" }, { id: "members", label: "Members" }]
      : []),
    ...(currentUserRole === "PROJECT_LEAD"
      ? [
          { id: "board", label: "Board" },
          { id: "screenLayout", label: "Screen Layout" },
          { id: "danger", label: "Danger Zone" },
        ]
      : []),
    ...(canManageCustomFields ? [{ id: "customFields", label: "Custom Fields" }] : []),
  ];

  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? "customFields");

  return (
    <div className="space-y-6">
      {/* Tab navigation */}
      <nav className="flex gap-1 border-b border-border-soft">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
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
      {activeTab === "members" && currentUserRole !== null && (
        <MembersTab
          members={members}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          canManageOverride={canManageMembersGrant}
          projectKey={projectKey}
        />
      )}
      {activeTab === "board" && currentUserRole === "PROJECT_LEAD" && (
        <BoardSettings projectKey={projectKey} />
      )}
      {activeTab === "screenLayout" && currentUserRole === "PROJECT_LEAD" && (
        <ScreenLayoutSettings projectKey={projectKey} />
      )}
      {activeTab === "danger" && currentUserRole === "PROJECT_LEAD" && (
        <DangerZoneTab project={project} projectKey={projectKey} isAdmin={isAdmin} />
      )}
      {activeTab === "customFields" && canManageCustomFields && (
        <CustomFieldsSettings orgId={orgId} projectKey={projectKey} />
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
        <label className="text-sm font-medium text-foreground">
          Project name
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 bg-surface-active border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">Project key</label>
        <div className="px-3 py-2 bg-surface-active border border-border-soft rounded-lg text-sm text-muted-foreground">
          <MonoMeta>{project.key}</MonoMeta>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Created</p>
          <p className="text-foreground">
            {new Date(project.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Owner</p>
          <p className="text-foreground">{ownerName}</p>
        </div>
      </div>

      <Button
        onClick={handleSave}
        disabled={saving}
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
  canManageOverride,
  projectKey,
}: {
  members: Member[];
  currentUserId: string;
  currentUserRole: ProjectMemberRole;
  canManageOverride: boolean;
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

  const canManage = currentUserRole === "PROJECT_LEAD" || canManageOverride;

  return (
    <div className="space-y-8">
      {/* Members list */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">
          Project members ({members.length})
        </h3>
        <div className="divide-y divide-border-soft rounded-xl border border-border-soft overflow-hidden">
          {members.map((member) => {
            const isOwner = member.role === "PROJECT_LEAD";
            const isSelf = member.userId === currentUserId;

            return (
              <div
                key={member.id}
                className="flex items-center gap-3 px-4 py-3 bg-surface"
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
                  <p className="text-sm font-medium text-foreground truncate">
                    {member.user.name ?? "Unnamed"}
                    {isSelf && (
                      <span className="text-muted-foreground ml-1">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
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
                    <option value="TEAM_MEMBER">Team Member</option>
                    <option value="VIEWER">Viewer</option>
                  </select>
                ) : (
                  <span
                    className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium",
                      roleColors[member.role]
                    )}
                  >
                    {roleLabels[member.role] ?? member.role}
                  </span>
                )}

                {/* Remove button */}
                {canManage && !isOwner && !isSelf && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setMemberToRemove(member)}
                    className="text-muted-foreground hover:text-danger hover:bg-danger-soft"
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{" "}
              <span className="font-medium text-foreground">
                {memberToRemove?.user.name ?? memberToRemove?.user.email}
              </span>{" "}
              from this project?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setMemberToRemove(null)}
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
  const [addRole, setAddRole] = useState<ProjectMemberRole>("TEAM_MEMBER");
  const [adding, setAdding] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create mode state
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [createRole, setCreateRole] = useState<ProjectMemberRole>("TEAM_MEMBER");
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
      setAddRole("TEAM_MEMBER");
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
      const result = await createUserAndAddToProject(projectKey, {
        name: newName.trim(),
        email: newEmail.trim(),
        password: newPassword,
        role: createRole,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${newName.trim()} created and added to project`);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setCreateRole("TEAM_MEMBER");
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
        <h3 className="text-sm font-medium text-foreground">Add member</h3>
        <button
          onClick={() => setMode(mode === "search" ? "create" : "search")}
          className="text-xs text-primary hover:text-primary/80 transition-colors"
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search users by email..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Search results dropdown */}
          {searchQuery.trim() && !selectedUser && (
            <div className="rounded-lg border border-border-soft bg-surface overflow-hidden">
              {searching ? (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  Searching...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  No users found
                </div>
              ) : (
                searchResults.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => setSelectedUser(user)}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-surface-active transition-colors"
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
                      <p className="text-sm text-foreground truncate">
                        {user.name ?? "Unnamed"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
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
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border-soft bg-surface">
              <Avatar size="sm">
                {selectedUser.avatarUrl && (
                  <AvatarImage src={selectedUser.avatarUrl} />
                )}
                <AvatarFallback>
                  {getInitials(selectedUser.name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">
                  {selectedUser.name ?? "Unnamed"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
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
                <option value="TEAM_MEMBER">Team Member</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <Button
                onClick={handleAddMember}
                disabled={adding}
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
            <label className="text-sm font-medium text-foreground">Name</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Full name"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Email</label>
            <Input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Password
            </label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Temporary password"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Role</label>
            <select
              value={createRole}
              onChange={(e) =>
                setCreateRole(e.target.value as ProjectMemberRole)
              }
              className={cn(selectStyles, "w-full")}
            >
              <option value="TEAM_MEMBER">Team Member</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </div>
          <Button
            onClick={handleCreateAndAdd}
            disabled={creating}
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
  isAdmin,
}: {
  project: ProjectSettingsProps["project"];
  projectKey: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [confirmInput, setConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [togglingPrivacy, setTogglingPrivacy] = useState(false);

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

  async function handlePrivacyToggle() {
    setTogglingPrivacy(true);
    try {
      await setProjectPrivacy(projectKey, !project.isPrivate);
      toast.success(project.isPrivate ? "Project is now public" : "Project is now private");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update privacy"
      );
    } finally {
      setTogglingPrivacy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      {/* Private project toggle — Admin only */}
      {isAdmin && (
        <div className="border border-border rounded-xl p-6 bg-surface-active">
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Project Visibility
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {project.isPrivate
              ? "This project is private — only members can see it."
              : "This project is public — all org members can find it."}
          </p>
          <Button
            variant="outline"
            onClick={handlePrivacyToggle}
            disabled={togglingPrivacy}
          >
            {togglingPrivacy
              ? "Updating..."
              : project.isPrivate
              ? "Make public"
              : "Make private"}
          </Button>
        </div>
      )}

      {/* Delete project */}
      <div className="border border-danger/30 rounded-xl p-6 bg-danger-soft">
        <h3 className="text-lg font-semibold text-danger mb-2">
          Delete Project
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Delete project {project.key}?
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. All issues, comments, and data will
              be permanently deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-sm text-foreground">
                Type <span className="font-bold text-foreground">{project.key}</span> to
                confirm
              </label>
              <Input
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder={project.key}
                className="font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDeleteDialog(false);
                  setConfirmInput("");
                }}
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
