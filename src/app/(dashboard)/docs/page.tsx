import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, FileText, ChevronRight, Lock } from "lucide-react";

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

  return memberships.map((m) => m.project);
}

export default async function DocsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const projects = await getProjectsWithDocs(session.user.id);
  const openProjects = projects.filter((p) => !p.isClosed);
  const closedProjects = projects.filter((p) => p.isClosed);

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
        <>
          {openProjects.length > 0 && (
            <div className="grid gap-3">
              {openProjects.map((project) => (
                <ProjectDocsCard key={project.id} project={project} />
              ))}
            </div>
          )}

          {closedProjects.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                Closed Projects
              </h2>
              <div className="grid gap-3">
                {closedProjects.map((project) => (
                  <ProjectDocsCard key={project.id} project={project} closed />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ProjectDocsCard({
  project,
  closed = false,
}: {
  project: {
    id: string;
    key: string;
    name: string;
    docSpace: { id: string; _count: { pages: number } } | null;
  };
  closed?: boolean;
}) {
  const pageCount = project.docSpace?._count.pages ?? 0;
  return (
    <Link
      href={`/projects/${project.key.toLowerCase()}/docs`}
      className="flex items-center gap-4 px-5 py-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl hover:border-indigo-400 dark:hover:border-indigo-600 transition-colors group"
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${closed ? "bg-zinc-400 dark:bg-zinc-600" : "bg-indigo-700"}`}>
        <span className="text-sm font-bold text-white">{project.key.slice(0, 2)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <p className={`font-medium truncate ${closed ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-900 dark:text-zinc-100"}`}>
            {project.name}
          </p>
          {closed && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-1.5 py-0.5 rounded flex-shrink-0">
              <Lock className="w-2.5 h-2.5" />
              Closed
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-500">
          {project.docSpace
            ? `${pageCount} page${pageCount !== 1 ? "s" : ""}${closed ? " · read-only" : ""}`
            : closed ? "No pages" : "No pages yet — get started"}
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
}
