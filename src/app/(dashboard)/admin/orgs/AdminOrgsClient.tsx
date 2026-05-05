"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Plus, Users, Trash2, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getAdminOrgs,
  getAdminOrgMembers,
  adminCreateOrg,
  adminAddOrgMember,
  adminRemoveOrgMember,
  adminDeleteOrg,
} from "../actions";
import type { Plan, OrgRole } from "@prisma/client";

type AdminOrg = {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
  createdAt: Date;
  owner: { id: string; name: string; email: string };
  _count: { members: number; projects: number };
};

type OrgMember = {
  role: OrgRole;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
};

type SimpleUser = { id: string; name: string; email: string };

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 48);
}

const PLAN_LABELS: Record<Plan, string> = { FREE: "Free", PRO: "Pro", TEAM: "Team" };
const ROLE_LABELS: Record<OrgRole, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };

export function AdminOrgsClient({
  initialOrgs,
  allUsers,
}: {
  initialOrgs: AdminOrg[];
  allUsers: SimpleUser[];
}) {
  const router = useRouter();
  const [orgs, setOrgs] = useState<AdminOrg[]>(initialOrgs);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [createPlan, setCreatePlan] = useState<Plan>("FREE");
  const [createOwnerId, setCreateOwnerId] = useState(allUsers[0]?.id ?? "");
  const [creating, setCreating] = useState(false);

  // Manage members dialog
  const [manageOrg, setManageOrg] = useState<AdminOrg | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<OrgRole>("MEMBER");
  const [addingMember, setAddingMember] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  // Delete dialog
  const [deleteOrg, setDeleteOrg] = useState<AdminOrg | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      startTransition(async () => {
        try {
          const result = await getAdminOrgs(search || undefined);
          setOrgs(result);
        } catch {
          // ignore
        }
      });
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => { setOrgs(initialOrgs); }, [initialOrgs]);

  // Auto-generate slug from name
  useEffect(() => {
    setCreateSlug(slugify(createName));
  }, [createName]);

  async function openManageMembers(org: AdminOrg) {
    setManageOrg(org);
    setMembers([]);
    setAddUserId("");
    setAddRole("MEMBER");
    setMembersLoading(true);
    try {
      const result = await getAdminOrgMembers(org.id);
      setMembers(result);
    } catch {
      toast.error("Failed to load members");
    } finally {
      setMembersLoading(false);
    }
  }

  async function handleCreate() {
    if (!createName || !createSlug || !createOwnerId) {
      toast.error("Name, slug, and owner are required");
      return;
    }
    setCreating(true);
    try {
      await adminCreateOrg({ name: createName, slug: createSlug, plan: createPlan, ownerId: createOwnerId });
      toast.success("Organization created");
      setCreateOpen(false);
      setCreateName("");
      setCreateSlug("");
      setCreatePlan("FREE");
      setCreateOwnerId(allUsers[0]?.id ?? "");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create org");
    } finally {
      setCreating(false);
    }
  }

  async function handleAddMember() {
    if (!manageOrg || !addUserId) return;
    setAddingMember(true);
    try {
      await adminAddOrgMember(manageOrg.id, addUserId, addRole);
      toast.success("Member added");
      const result = await getAdminOrgMembers(manageOrg.id);
      setMembers(result);
      setAddUserId("");
      setAddRole("MEMBER");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setAddingMember(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!manageOrg) return;
    setRemovingUserId(userId);
    try {
      await adminRemoveOrgMember(manageOrg.id, userId);
      toast.success("Member removed");
      setMembers((prev) => prev.filter((m) => m.user.id !== userId));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setRemovingUserId(null);
    }
  }

  async function handleDelete() {
    if (!deleteOrg || confirmName !== deleteOrg.name) return;
    setDeleting(true);
    try {
      await adminDeleteOrg(deleteOrg.id);
      toast.success("Organization deleted");
      setDeleteOrg(null);
      setConfirmName("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete org");
    } finally {
      setDeleting(false);
    }
  }

  // Users not yet in the org being managed
  const memberUserIds = new Set(members.map((m) => m.user.id));
  const availableUsers = allUsers.filter((u) => !memberUserIds.has(u.id));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            placeholder="Search organizations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          />
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1" />
          Create Org
        </Button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm dark:shadow-none">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Organization</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Owner</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Plan</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Members</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Projects</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {orgs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500 text-sm">No organizations found.</td>
              </tr>
            ) : (
              orgs.map((org) => (
                <tr key={org.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{org.name}</p>
                    <p className="text-xs text-zinc-500">{org.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-zinc-400">{org.owner.name}</p>
                    <p className="text-xs text-zinc-500">{org.owner.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700">
                      {PLAN_LABELS[org.plan]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-400">{org._count.members}</td>
                  <td className="px-4 py-3 text-sm text-zinc-400">{org._count.projects}</td>
                  <td className="px-4 py-3 text-sm text-zinc-500">{new Date(org.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => openManageMembers(org)} title="Manage members">
                        <Users className="w-3.5 h-3.5 text-zinc-400" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => { setDeleteOrg(org); setConfirmName(""); }}>
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

      {/* Create Org Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Organization</DialogTitle>
            <DialogDescription>Set up a new workspace and assign an owner.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1 block">Name</label>
              <Input
                placeholder="Acme Corp"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1 block">Slug</label>
              <Input
                placeholder="acme-corp"
                value={createSlug}
                onChange={(e) => setCreateSlug(e.target.value)}
                className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1 block">Plan</label>
              <select
                value={createPlan}
                onChange={(e) => setCreatePlan(e.target.value as Plan)}
                className="w-full h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              >
                <option value="FREE">Free</option>
                <option value="PRO">Pro</option>
                <option value="TEAM">Team</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1 block">Owner</label>
              <select
                value={createOwnerId}
                onChange={(e) => setCreateOwnerId(e.target.value)}
                className="w-full h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              >
                {allUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} — {u.email}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating}>{creating ? "Creating..." : "Create Org"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage Members Dialog */}
      <Dialog open={!!manageOrg} onOpenChange={(open) => !open && setManageOrg(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Members — {manageOrg?.name}</DialogTitle>
            <DialogDescription>Add or remove members and set their role within this org.</DialogDescription>
          </DialogHeader>

          {/* Current members list */}
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {membersLoading ? (
              <p className="text-sm text-zinc-500 py-2">Loading...</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-zinc-500 py-2">No members yet.</p>
            ) : (
              members.map((m) => (
                <div key={m.user.id} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <Avatar className="w-7 h-7">
                      <AvatarImage src={m.user.avatarUrl ?? undefined} />
                      <AvatarFallback className="bg-indigo-700 text-white text-xs font-semibold">
                        {getInitials(m.user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{m.user.name}</p>
                      <p className="text-xs text-zinc-500">{m.user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={
                      m.role === "OWNER"
                        ? "bg-indigo-600/20 text-indigo-400 border-indigo-600/30"
                        : m.role === "ADMIN"
                        ? "bg-amber-600/20 text-amber-400 border-amber-600/30"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700"
                    }>
                      {ROLE_LABELS[m.role]}
                    </Badge>
                    {m.role !== "OWNER" && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleRemoveMember(m.user.id)}
                        disabled={removingUserId === m.user.id}
                      >
                        <UserMinus className="w-3.5 h-3.5 text-red-400" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Add member */}
          {availableUsers.length > 0 && (
            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-3 space-y-2">
              <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Add member</p>
              <div className="flex gap-2">
                <select
                  value={addUserId}
                  onChange={(e) => setAddUserId(e.target.value)}
                  className="flex-1 h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">Select user...</option>
                  {availableUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} — {u.email}</option>
                  ))}
                </select>
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value as OrgRole)}
                  className="w-28 h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="MEMBER">Member</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <Button onClick={handleAddMember} disabled={addingMember || !addUserId} size="sm">
                  {addingMember ? "Adding..." : "Add"}
                </Button>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setManageOrg(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Org Dialog */}
      <Dialog open={!!deleteOrg} onOpenChange={(open) => !open && setDeleteOrg(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Organization</DialogTitle>
            <DialogDescription>
              This will permanently delete the organization and all its projects, issues, and data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Type <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">{deleteOrg?.name}</span> to confirm.
            </p>
            <Input
              placeholder={deleteOrg?.name}
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOrg(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting || confirmName !== deleteOrg?.name}>
              {deleting ? "Deleting..." : "Delete Org"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
