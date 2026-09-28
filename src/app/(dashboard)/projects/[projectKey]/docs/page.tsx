import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { BookOpen, Globe } from "lucide-react";
import { CreateDocItemButtons } from "@/components/docs/create-doc-item-buttons";
import { DocVisibilityToggle } from "@/components/docs/doc-visibility-toggle";
import { RecentlyViewedDocs } from "@/components/docs/recently-viewed-docs";
import { DocsListBody } from "@/components/docs/docs-list-body";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { canEditIssues, canManageProject, getUserGrants } from "@/lib/permissions";
import { ProjectMemberRole } from "@prisma/client";
import { upsertDocSpaceSafe } from "@/app/api/docs/_helpers";


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

  const docSpace = await upsertDocSpaceSafe({
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

export default async function ProjectDocsPage(props: { params: Promise<{ projectKey: string }> }) {
  const params = await props.params;
  const session = await requireUser();

  const data = await getDocSpaceData(params.projectKey, session.user.id);
  if (!data) redirect("/projects");

  const { project, docSpace, role, grants, recentlyViewed } = data;
  const canEdit = !project.isClosed && canEditIssues(role, grants);
  const canManage = !project.isClosed && canManageProject(role, grants);

  const totalPages = docSpace.sections.reduce((sum, s) => sum + s.pages.length, 0) + docSpace.pages.length;
  const isEmpty = totalPages === 0 && docSpace.sections.length === 0;

  if (isEmpty) {
    return (
      <div className="py-10">
        <EmptyState
          icon={BookOpen}
          title="No docs yet"
          message={`${project.name}'s documentation space is ready. ${
            canEdit ? "Add a section or page to get started." : "Check back later for documentation."
          }`}
        />
        {canEdit && (
          <div className="flex justify-center mt-2">
            <CreateDocItemButtons projectKey={project.key.toLowerCase()} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Docs"
        subtitle={`${totalPages} page${totalPages !== 1 ? "s" : ""}${
          docSpace.sections.length > 0
            ? ` across ${docSpace.sections.length} section${docSpace.sections.length !== 1 ? "s" : ""}`
            : ""
        }`}
        actions={
          <div className="flex items-center gap-2.5">
            {docSpace.isPublic && !canManage && (
              <span className="flex items-center gap-1 bg-success-soft text-success px-2.5 py-0.5 rounded-full text-xs font-semibold">
                <Globe className="w-3 h-3" />
                Public
              </span>
            )}
            {canManage && (
              <DocVisibilityToggle
                projectKey={project.key.toLowerCase()}
                initialIsPublic={docSpace.isPublic}
              />
            )}
          </div>
        }
      />

      <RecentlyViewedDocs recentlyViewed={recentlyViewed} projectKey={project.key.toLowerCase()} />

      <DocsListBody
        projectKey={project.key.toLowerCase()}
        pages={docSpace.pages}
        sections={docSpace.sections}
      />
    </div>
  );
}
