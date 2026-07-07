"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Plus, RefreshCw, Trash2, Mail } from "lucide-react";
import type { OrgRole } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getAdminInvites,
  adminCreateInvite,
  adminResendInvite,
  adminRevokeInvite,
} from "../actions";

type OrgOption = { id: string; name: string; slug: string };

type AdminInvite = {
  id: string;
  email: string;
  role: OrgRole;
  accepted: boolean;
  acceptedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  org: { id: string; name: string; slug: string };
  invitedBy: { id: string; name: string; email: string };
  status: "ACCEPTED" | "EXPIRED" | "PENDING";
};

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: AdminInvite["status"] }) {
  if (status === "ACCEPTED") {
    return (
      <Badge className="bg-green-600/20 text-green-400 border-green-600/30">Accepted</Badge>
    );
  }
  if (status === "PENDING") {
    return (
      <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30">Pending</Badge>
    );
  }
  return (
    <Badge className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700">
      Expired
    </Badge>
  );
}

export function AdminInvitesClient({
  initialInvites,
  orgs,
}: {
  initialInvites: AdminInvite[];
  orgs: OrgOption[];
}) {
  const router = useRouter();
  const [invites, setInvites] = useState<AdminInvite[]>(initialInvites);
  const [search, setSearch] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [, startTransition] = useTransition();

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createOrgId, setCreateOrgId] = useState(orgs[0]?.id ?? "");
  const [createRole, setCreateRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const [creating, setCreating] = useState(false);

  // Revoke confirm dialog
  const [revokeInvite, setRevokeInvite] = useState<AdminInvite | null>(null);
  const [revoking, setRevoking] = useState(false);

  // Debounced search + org filter
  useEffect(() => {
    const timeout = setTimeout(() => {
      startTransition(async () => {
        try {
          const result = await getAdminInvites(search || undefined, orgFilter || undefined);
          setInvites(result);
        } catch {
          // ignore search errors
        }
      });
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, orgFilter]);

  useEffect(() => {
    setInvites(initialInvites);
  }, [initialInvites]);

  const handleCreate = async () => {
    if (!createEmail || !createOrgId) {
      toast.error("Email and organization are required");
      return;
    }
    setCreating(true);
    try {
      const result = await adminCreateInvite(createOrgId, createEmail, createRole);
      if (result.emailError) {
        toast.success("Invite created, but email failed to send: " + result.emailError);
      } else {
        toast.success("Invite sent successfully");
      }
      setCreateOpen(false);
      setCreateEmail("");
      setCreateOrgId(orgs[0]?.id ?? "");
      setCreateRole("MEMBER");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setCreating(false);
    }
  };

  const handleResend = async (invite: AdminInvite) => {
    try {
      const result = await adminResendInvite(invite.id);
      if (result.emailError) {
        toast.success("Invite refreshed, but email failed to send: " + result.emailError);
      } else {
        toast.success("Invite resent successfully");
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resend invite");
    }
  };

  const handleRevoke = async () => {
    if (!revokeInvite) return;
    setRevoking(true);
    try {
      await adminRevokeInvite(revokeInvite.id);
      toast.success("Invite revoked");
      setRevokeInvite(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke invite");
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            placeholder="Search by email or org..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          />
        </div>
        <select
          value={orgFilter}
          onChange={(e) => setOrgFilter(e.target.value)}
          className="h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">All Organizations</option>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1" />
          Create Invite
        </Button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm dark:shadow-none">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Email
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Organization
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Role
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Status
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Invited By
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Sent
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Expires
              </th>
              <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {invites.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-500 text-sm">
                  No invites found.
                </td>
              </tr>
            ) : (
              invites.map((invite) => (
                <tr
                  key={invite.id}
                  className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                >
                  <td className="px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100">
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                      {invite.email}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-900 dark:text-zinc-100">
                    {invite.org.name}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700">
                      {invite.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={invite.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500">
                    {invite.invitedBy.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500">
                    {formatDate(invite.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-500">
                    {invite.accepted && invite.acceptedAt
                      ? `Accepted ${formatDate(invite.acceptedAt)}`
                      : formatDate(invite.expiresAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {!invite.accepted && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="Resend invite"
                            onClick={() => handleResend(invite)}
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="Revoke invite"
                            onClick={() => setRevokeInvite(invite)}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Invite Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Invite</DialogTitle>
            <DialogDescription>Send an organization invite by email.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1 block">
                Organization
              </label>
              {orgs.length === 0 ? (
                <p className="text-sm text-zinc-500">No organizations available.</p>
              ) : (
                <select
                  value={createOrgId}
                  onChange={(e) => setCreateOrgId(e.target.value)}
                  className="w-full h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                >
                  {orgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1 block">
                Email
              </label>
              <Input
                type="email"
                placeholder="invitee@example.com"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1 block">
                Role
              </label>
              <select
                value={createRole}
                onChange={(e) => setCreateRole(e.target.value as "ADMIN" | "MEMBER")}
                className="w-full h-8 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              >
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || orgs.length === 0}>
              {creating ? "Sending..." : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirm Dialog */}
      <Dialog open={!!revokeInvite} onOpenChange={(open) => !open && setRevokeInvite(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke Invite</DialogTitle>
            <DialogDescription>
              Are you sure you want to revoke the invite for {revokeInvite?.email}?
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-zinc-400">
            The invite link will stop working immediately. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeInvite(null)} disabled={revoking}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRevoke} disabled={revoking}>
              {revoking ? "Revoking..." : "Revoke Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
