import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { ProjectNav } from "@/components/projects/ProjectNav";
import { ProjectShortcuts } from "@/components/projects/ProjectShortcuts";

async function getProject(key: string, userId: string) {
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

  const project = await getProject(params.projectKey, session.user.id);
  if (!project) notFound();

  const isAdmin = session.user.role === "ADMIN";
  if (project.isClosed && !isAdmin) {
    const pathname = headers().get("x-pathname") ?? "";
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
