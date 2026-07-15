import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { ProjectNav } from "@/components/projects/ProjectNav";
import { ProjectShortcuts } from "@/components/projects/ProjectShortcuts";
import { canManageCustomFields } from "@/lib/permissions";

async function getProjectAsMember(key: string, userId: string) {
  return prisma.project.findFirst({
    where: {
      key: key.toUpperCase(),
      members: { some: { userId } },
    },
    include: { _count: { select: { issues: true } } },
  });
}

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { projectKey: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const pathname = headers().get("x-pathname") ?? "";
  const isSettingsPath = /\/projects\/[^/]+\/settings(\/|$)/i.test(pathname);

  let project = await getProjectAsMember(params.projectKey, session.user.id);

  if (!project) {
    // Org OWNER/ADMIN (and platform ADMIN) can reach the settings page even
    // without a ProjectMember row — the settings page itself enforces what tabs
    // they can see. For all other paths, keep the existing notFound() behavior.
    if (isSettingsPath) {
      const isPlatformAdmin = session.user.role === "ADMIN";
      let allowedViaOrgRole = isPlatformAdmin;

      if (!allowedViaOrgRole) {
        const projectForOrg = await prisma.project.findUnique({
          where: { key: params.projectKey.toUpperCase() },
          select: { orgId: true, isPrivate: true },
        });
        if (projectForOrg) {
          const orgMembership = await prisma.orgMember.findUnique({
            where: {
              orgId_userId: {
                orgId: projectForOrg.orgId,
                userId: session.user.id,
              },
            },
            select: { role: true },
          });
          allowedViaOrgRole =
            orgMembership !== null && canManageCustomFields(orgMembership.role);
        }
      }

      if (!allowedViaOrgRole) notFound();

      // Fetch without membership filter for org/platform admins
      project = await prisma.project.findFirst({
        where: { key: params.projectKey.toUpperCase() },
        include: { _count: { select: { issues: true } } },
      });
      if (!project) notFound();
    } else {
      notFound();
    }
  }

  const isAdmin = session.user.role === "ADMIN";
  if (project.isClosed && !isAdmin) {
    const isDocsPath = /\/projects\/[^/]+\/docs(\/|$)/i.test(pathname);
    if (!isDocsPath) redirect("/projects");
  }

  return (
    <div className="space-y-0 -m-4 sm:-m-6">
      {/* Project header */}
      <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-0 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3 mb-4 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-indigo-700 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-white">{project.key.slice(0, 2)}</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 truncate">{project.name}</h1>
            {project.description && (
              <p className="text-xs text-zinc-500">{project.description}</p>
            )}
          </div>
        </div>
        <ProjectNav projectKey={params.projectKey} isClosed={project.isClosed} isAdmin={isAdmin} />
      </div>
      <div className="p-4 sm:p-6">{children}</div>
      <ProjectShortcuts projectKey={params.projectKey} />
    </div>
  );
}
