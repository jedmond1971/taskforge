import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canManageApiKeys } from "@/lib/permissions";
import { ApiKeysSettings } from "./ApiKeysSettings";
import { GroupsSettings } from "./GroupsSettings";
import { StorageUsageSettings } from "./StorageUsageSettings";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ShieldOff } from "lucide-react";


export default async function OrgSettingsPage() {
  const session = await requireUser();

  const orgId = session.user.orgId;
  if (!orgId) redirect("/");

  const isPlatformAdmin = session.user.role === "ADMIN";
  if (!isPlatformAdmin) {
    const membership = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: session.user.id } },
      select: { role: true },
    });
    if (!membership || !canManageApiKeys(membership.role)) {
      return (
        <div className="py-20">
          <EmptyState
            icon={ShieldOff}
            title="Access Denied"
            message="Only organization admins and owners can manage API keys."
          />
        </div>
      );
    }
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader title="Organization Settings" subtitle={org?.name} />

      <div className="bg-surface shadow-[var(--shadow-panel)] rounded-xl p-6">
        <ApiKeysSettings orgId={orgId} />
      </div>

      <div className="bg-surface shadow-[var(--shadow-panel)] rounded-xl p-6">
        <GroupsSettings orgId={orgId} />
      </div>

      <div className="bg-surface shadow-[var(--shadow-panel)] rounded-xl p-6">
        <StorageUsageSettings orgId={orgId} />
      </div>
    </div>
  );
}
