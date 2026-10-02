"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { UserRole } from "@prisma/client";
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
import {
  adminUpdateUser,
  adminDeleteUser,
  adminResetUserPassword,
  adminAddUserToProject,
  adminGetProjectsForSelect,
} from "../actions";

export type UserActionTarget = { id: string; name: string; email: string; role: UserRole };
export type UserAction = "edit" | "reset" | "addToProject" | "delete";

const selectClass =
  "w-full h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary";
const labelClass = "text-xs font-medium text-muted-foreground mb-1 block";

type DialogProps = {
  user: UserActionTarget;
  onClose: () => void;
  onDone: (action: UserAction) => void;
};

/**
 * Shared by the Users list and the user-detail page (JFR-172). Renders the dialog for `action`
 * on `user`; each dialog mounts fresh when opened, so its form state never leaks between users.
 */
export function UserActionDialogs({
  user,
  action,
  onClose,
  onDone,
}: {
  user: UserActionTarget | null;
  action: UserAction | null;
  onClose: () => void;
  onDone: (action: UserAction) => void;
}) {
  if (!user || !action) return null;
  const props = { user, onClose, onDone };
  switch (action) {
    case "edit":
      return <EditUserDialog key={user.id} {...props} />;
    case "reset":
      return <ResetPasswordDialog key={user.id} {...props} />;
    case "addToProject":
      return <AddToProjectDialog key={user.id} {...props} />;
    case "delete":
      return <DeleteUserDialog key={user.id} {...props} />;
  }
}

function EditUserDialog({ user, onClose, onDone }: DialogProps) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<"ADMIN" | "TEAM_MEMBER">(user.role === "ADMIN" ? "ADMIN" : "TEAM_MEMBER");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const result = await adminUpdateUser(user.id, { name, email, role });
      if (!result.success) { toast.error(result.error); return; }
      toast.success("User updated successfully");
      onClose();
      onDone("edit");
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>Update user details and role.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Name</label>
            <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <Input type="email" placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "TEAM_MEMBER")} className={selectClass}>
              <option value="TEAM_MEMBER">Team Member</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose, onDone }: DialogProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (password !== confirm) { toast.error("Passwords do not match"); return; }
    setSaving(true);
    try {
      const result = await adminResetUserPassword(user.id, password);
      if (!result.success) { toast.error(result.error); return; }
      toast.success("Password reset successfully");
      onClose();
      onDone("reset");
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>Set a new password for {user.name}. No current password required.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className={labelClass}>New Password</label>
            <Input type="password" placeholder="Minimum 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Confirm Password</label>
            <Input type="password" placeholder="Re-enter password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving..." : "Reset Password"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddToProjectDialog({ user, onClose, onDone }: DialogProps) {
  const [options, setOptions] = useState<{ id: string; name: string; key: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState("");
  const [role, setRole] = useState<"PROJECT_LEAD" | "TEAM_MEMBER" | "VIEWER">("TEAM_MEMBER");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminGetProjectsForSelect()
      .then((projects) => {
        if (cancelled) return;
        setOptions(projects);
        if (projects.length > 0) setProjectId(projects[0].id);
      })
      .catch(() => !cancelled && toast.error("Failed to load projects"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const submit = async () => {
    if (!projectId) return;
    setAdding(true);
    try {
      const result = await adminAddUserToProject(user.id, projectId, role);
      if (!result.success) { toast.error(result.error); return; }
      toast.success(`${user.name} added to project`);
      onClose();
      onDone("addToProject");
    } catch {
      toast.error("Something went wrong");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Project</DialogTitle>
          <DialogDescription>
            Add {user.name} to a project. If they aren&apos;t already in the project&apos;s organization, they will be joined automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Project</label>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading projects...</p>
            ) : options.length === 0 ? (
              <p className="text-sm text-muted-foreground">No projects available.</p>
            ) : (
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={selectClass}>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.key})</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className={labelClass}>Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "PROJECT_LEAD" | "TEAM_MEMBER" | "VIEWER")}
              className={selectClass}
            >
              <option value="PROJECT_LEAD">Project Lead</option>
              <option value="TEAM_MEMBER">Team Member</option>
              <option value="VIEWER">Viewer</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={adding}>Cancel</Button>
          <Button onClick={submit} disabled={adding || loading || !projectId}>{adding ? "Adding..." : "Add to Project"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({ user, onClose, onDone }: DialogProps) {
  const [deleting, setDeleting] = useState(false);

  const submit = async () => {
    setDeleting(true);
    try {
      const result = await adminDeleteUser(user.id);
      if (!result.success) { toast.error(result.error); return; }
      toast.success("User deleted successfully");
      onClose();
      onDone("delete");
    } catch {
      toast.error("Something went wrong");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete User</DialogTitle>
          <DialogDescription>Are you sure you want to delete {user.name}?</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This will remove the user from all projects. This action cannot be undone.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={deleting}>{deleting ? "Deleting..." : "Delete User"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
