import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, FileText, ChevronRight } from "lucide-react";

async function getProjectsWithDocs(userId: string) {
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    include: {
      project: {
        include: {
          docSpace: {
            select: {
              id: true,
              _count: { select: { pages: true } },
            },
          },
        },
      },
    },
    orderBy: { project: { updatedAt: "desc" } },
  });

  return memberships
    .filter((m) => !m.project.isArchived)
    .map((m) => m.project);
}

export default async function DocsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const projects = await getProjectsWithDocs(session.user.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Docs</h1>
        <p className="text-zinc-500 text-sm mt-1">Documentation spaces across your projects</p>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <BookOpen className="w-12 h-12 text-zinc-300 dark:text-zinc-700" />
          <p className="text-lg font-medium text-zinc-500">No projects yet</p>
          <p className="text-sm text-zinc-400 dark:text-zinc-600">
            Join or create a project to start building documentation.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {projects.map((project) => {
            const pageCount = project.docSpace?._count.pages ?? 0;
            return (
              <Link
                key={project.id}
                href={`/projects/${project.key.toLowerCase()}/docs`}
                className="flex items-center gap-4 px-5 py-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-indigo-700 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-white">{project.key.slice(0, 2)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">{project.name}</p>
                  <p className="text-sm text-zinc-500">
                    {project.docSpace
                      ? `${pageCount} page${pageCount !== 1 ? "s" : ""}`
                      : "No pages yet — get started"}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-zinc-400">
                  {project.docSpace ? (
                    <FileText className="w-4 h-4" />
                  ) : (
                    <BookOpen className="w-4 h-4" />
                  )}
                  <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
