import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { BookOpen, Globe } from "lucide-react";
import { CreateDocItemButtons } from "@/components/docs/create-doc-item-buttons";
import { DocVisibilityToggle } from "@/components/docs/doc-visibility-toggle";
import { RecentlyViewedDocs } from "@/components/docs/recently-viewed-docs";
import { DocsListBody } from "@/components/docs/docs-list-body";
import { canEditIssues, canManageProject, getUserGrants } from "@/lib/permissions";
import { ProjectMemberRole } from "@prisma/client";

async function getDocSpaceData(projectKey: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase() },
    select: { id: true, key: true, name: true, isClosed: true, orgId: true },
  });
  if (!project) return null;

  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId: project.id } },
    select: { role: true },
  });
  if (!member) return null;

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
            select: {
              id: true, title: true, type: true, status: true, updatedAt: true, mimeType: true,
              author: { select: { id: true, name: true, avatarUrl: true } },
            },
          },
        },
      },
      pages: {
        where: { sectionId: null },
        orderBy: { position: "asc" },
        select: {
          id: true, title: true, type: true, status: true, updatedAt: true, mimeType: true,
          author: { select: { id: true, name: true, avatarUrl: true } },
        },
      },
    },
  });

  const grants = await getUserGrants(userId, project.orgId, project.id);

  const recentlyViewed = await prisma.docPageView.findMany({
    where: { userId, page: { docSpaceId: docSpace.id } },
    orderBy: { viewedAt: "desc" },
    take: 6,
    include: {
      page: {
        select: {
          id: true, title: true, type: true, status: true, mimeType: true,
          author: { select: { id: true, name: true, avatarUrl: true } },
        },
      },
    },
  });

  return { project, docSpace, role: member.role as ProjectMemberRole, grants, recentlyViewed };
}

export default async function ProjectDocsPage({ params }: { params: { projectKey: string } }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getDocSpaceData(params.projectKey, session.user.id);
  if (!data) redirect("/projects");

  const { project, docSpace, role, grants, recentlyViewed } = data;
  const canEdit = !project.isClosed && canEditIssues(role, grants);
  const canManage = !project.isClosed && canManageProject(role, grants);

  const totalPages = docSpace.sections.reduce((sum, s) => sum + s.pages.length, 0) + docSpace.pages.length;
  const isEmpty = totalPages === 0 && docSpace.sections.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <BookOpen className="w-14 h-14 text-zinc-300 dark:text-zinc-700" />
        <div className="text-center">
          <p className="text-lg font-semibold text-zinc-700 dark:text-zinc-300">No docs yet</p>
          <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-1">
            {project.name}&apos;s documentation space is ready.{" "}
            {canEdit ? "Add a section or page to get started." : "Check back later for documentation."}
          </p>
        </div>
        {canEdit && (
          <div className="mt-2">
            <CreateDocItemButtons projectKey={project.key.toLowerCase()} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Docs</h2>
            {docSpace.isPublic && !canManage && (
              <span className="flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 px-2.5 py-0.5 rounded-full text-xs font-semibold">
                <Globe className="w-3 h-3" />
                Public
              </span>
            )}
          </div>
          <p className="text-zinc-500 text-sm">
            {totalPages} page{totalPages !== 1 ? "s" : ""}
            {docSpace.sections.length > 0 && ` across ${docSpace.sections.length} section${docSpace.sections.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        {canManage && (
          <DocVisibilityToggle
            projectKey={project.key.toLowerCase()}
            initialIsPublic={docSpace.isPublic}
          />
        )}
      </div>

      <RecentlyViewedDocs recentlyViewed={recentlyViewed} projectKey={project.key.toLowerCase()} />

      <DocsListBody
        projectKey={project.key.toLowerCase()}
        pages={docSpace.pages}
        sections={docSpace.sections}
      />
    </div>
  );
}
