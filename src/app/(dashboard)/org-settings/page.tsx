import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canManageApiKeys } from "@/lib/permissions";
import { ApiKeysSettings } from "./ApiKeysSettings";

export default async function OrgSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

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
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <h2 className="text-lg font-semibold text-zinc-100 mb-2">Access Denied</h2>
            <p className="text-sm text-zinc-500">
              Only organization admins and owners can manage API keys.
            </p>
          </div>
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
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Organization Settings</h1>
        <p className="text-zinc-500 text-sm mt-1">{org?.name}</p>
      </div>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <ApiKeysSettings orgId={orgId} />
      </div>
    </div>
  );
}
