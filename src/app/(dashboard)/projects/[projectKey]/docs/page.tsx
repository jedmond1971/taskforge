import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, FileText, FolderOpen, Plus } from "lucide-react";

async function getDocSpaceData(projectKey: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: {
      key: projectKey.toUpperCase(),
      members: { some: { userId } },
    },
    select: { id: true, key: true, name: true },
  });
  if (!project) return null;

  const docSpace = await prisma.docSpace.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id },
    update: {},
    include: {
      sections: {
        orderBy: { position: "asc" },
        include: {
          pages: {
            orderBy: { position: "asc" },
            select: { id: true, title: true, type: true, updatedAt: true },
          },
        },
      },
      pages: {
        where: { sectionId: null },
        orderBy: { position: "asc" },
        select: { id: true, title: true, type: true, updatedAt: true },
      },
    },
  });

  return { project, docSpace };
}

export default async function ProjectDocsPage({ params }: { params: { projectKey: string } }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getDocSpaceData(params.projectKey, session.user.id);
  if (!data) redirect("/projects");

  const { project, docSpace } = data;
  const totalPages = docSpace.sections.reduce((sum, s) => sum + s.pages.length, 0) + docSpace.pages.length;
  const isEmpty = totalPages === 0 && docSpace.sections.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <BookOpen className="w-14 h-14 text-zinc-300 dark:text-zinc-700" />
        <div className="text-center">
          <p className="text-lg font-semibold text-zinc-700 dark:text-zinc-300">No docs yet</p>
          <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-1">
            {project.name}&apos;s documentation space is ready. Add a section or page to get started.
          </p>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <button
            disabled
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg opacity-50 cursor-not-allowed"
            title="Coming in Phase 2"
          >
            <Plus className="w-4 h-4" />
            New Section
          </button>
          <button
            disabled
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg opacity-50 cursor-not-allowed"
            title="Coming in Phase 2"
          >
            <FileText className="w-4 h-4" />
            New Page
          </button>
        </div>
        <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-1">
          Full editor coming in Phase 2
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Docs</h2>
          <p className="text-zinc-500 text-sm">
            {totalPages} page{totalPages !== 1 ? "s" : ""}
            {docSpace.sections.length > 0 && ` across ${docSpace.sections.length} section${docSpace.sections.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          disabled
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg opacity-50 cursor-not-allowed"
          title="Coming in Phase 2"
        >
          <Plus className="w-4 h-4" />
          New
        </button>
      </div>

      {/* Unsectioned pages */}
      {docSpace.pages.length > 0 && (
        <div className="space-y-1">
          {docSpace.pages.map((page) => (
            <PageRow key={page.id} page={page} projectKey={project.key.toLowerCase()} />
          ))}
        </div>
      )}

      {/* Sections */}
      {docSpace.sections.map((section) => (
        <div key={section.id} className="space-y-1">
          <div className="flex items-center gap-2 py-1">
            <FolderOpen className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
              {section.title}
            </span>
            <span className="text-xs text-zinc-400">({section.pages.length})</span>
          </div>
          {section.pages.length === 0 ? (
            <p className="pl-6 text-sm text-zinc-400 italic">No pages in this section</p>
          ) : (
            section.pages.map((page) => (
              <PageRow key={page.id} page={page} projectKey={project.key.toLowerCase()} indent />
            ))
          )}
        </div>
      ))}
    </div>
  );
}

function PageRow({
  page,
  projectKey,
  indent = false,
}: {
  page: { id: string; title: string; type: string; updatedAt: Date };
  projectKey: string;
  indent?: boolean;
}) {
  return (
    <Link
      href={`/projects/${projectKey}/docs/${page.id}`}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors group ${indent ? "ml-5" : ""}`}
    >
      <FileText className="w-4 h-4 text-zinc-400 flex-shrink-0" />
      <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 truncate">
        {page.title}
      </span>
      <span className="text-xs text-zinc-400 hidden sm:block">
        {new Date(page.updatedAt).toLocaleDateString()}
      </span>
    </Link>
  );
}
