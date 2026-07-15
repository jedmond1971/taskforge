import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { ProjectSettings } from "./ProjectSettings";
import { canManageCustomFields } from "@/lib/permissions";

export default async function SettingsPage({
  params,
}: {
  params: { projectKey: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Fetch project without a membership filter so org admins who aren't project
  // members can still reach the Custom Fields tab.
  const project = await prisma.project.findFirst({
    where: { key: params.projectKey.toUpperCase() },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true },
          },
        },
        orderBy: { role: "asc" },
      },
    },
  });
  if (!project) notFound();

  const currentMember = project.members.find(
    (m) => m.userId === session.user.id
  );

  // Determine if the current user can manage org-level custom field definitions.
  // Platform admins always can; org OWNER/ADMIN role also grants access.
  let userCanManageCustomFields = session.user.role === "ADMIN";
  if (!userCanManageCustomFields) {
    const orgMembership = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: project.orgId, userId: session.user.id } },
      select: { role: true },
    });
    userCanManageCustomFields =
      orgMembership !== null && canManageCustomFields(orgMembership.role);
  }

  // Private projects: hide existence from users who are neither a project member,
  // a platform admin, nor an org admin who can manage custom fields.
  if (
    project.isPrivate &&
    !currentMember &&
    session.user.role !== "ADMIN" &&
    !userCanManageCustomFields
  ) {
    notFound();
  }

  // Page-level access gate: must be PROJECT_LEAD or an org/platform admin.
  const isProjectLead = currentMember?.role === "PROJECT_LEAD";
  if (!isProjectLead && !userCanManageCustomFields) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-zinc-100 mb-2">
            Access Denied
          </h2>
          <p className="text-sm text-zinc-500">
            You don&apos;t have permission to access project settings.
          </p>
        </div>
      </div>
    );
  }

  const owner = project.members.find((m) => m.role === "PROJECT_LEAD");

  return (
    <ProjectSettings
      project={{
        id: project.id,
        name: project.name,
        key: project.key,
        description: project.description,
        createdAt: project.createdAt.toISOString(),
        isPrivate: project.isPrivate,
      }}
      members={project.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        user: m.user,
      }))}
      currentUserId={session.user.id}
      currentUserRole={currentMember?.role ?? null}
      ownerName={owner?.user.name ?? "Unknown"}
      projectKey={params.projectKey}
      isAdmin={session.user.role === "ADMIN"}
      orgId={project.orgId}
      canManageCustomFields={userCanManageCustomFields}
    />
  );
}
