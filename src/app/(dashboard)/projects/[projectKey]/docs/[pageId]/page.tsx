import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { DocPageEditor } from "@/components/docs/doc-page-editor";
import { DocDocumentView } from "@/components/docs/doc-document-view";
import { SetPageTitle } from "@/components/layout/PageTitleContext";
import { canEditIssues } from "@/lib/permissions";
import { ProjectMemberRole } from "@prisma/client";

async function getPageData(projectKey: string, pageId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase() },
    select: { id: true, key: true, name: true, isClosed: true },
  });
  if (!project) return null;

  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId: project.id } },
    select: { role: true },
  });
  if (!member) return null;

  const docSpace = await prisma.docSpace.findUnique({
    where: { projectId: project.id },
    select: { id: true },
  });
  if (!docSpace) return null;

  const page = await prisma.docPage.findFirst({
    where: { id: pageId, docSpaceId: docSpace.id },
    include: {
      author: { select: { id: true, name: true, avatarUrl: true } },
    },
  });
  if (!page) return null;

  const revisions = await prisma.pageRevision.findMany({
    where: { pageId: page.id },
    orderBy: { createdAt: "desc" },
    include: {
      author: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  return { project, page, revisions, role: member.role as ProjectMemberRole, isClosed: project.isClosed };
}

export default async function DocPagePage({
  params,
}: {
  params: { projectKey: string; pageId: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getPageData(params.projectKey, params.pageId, session.user.id);
  if (!data) notFound();

  const { project, page, revisions, role, isClosed } = data;
  const readOnly = isClosed || !canEditIssues(role);

  const serializedPage = {
    ...page,
    updatedAt: page.updatedAt.toISOString(),
    createdAt: page.createdAt.toISOString(),
  };

  if (page.type === "DOCUMENT") {
    return (
      <>
        <SetPageTitle title={page.title} />
        <DocDocumentView
          page={serializedPage}
          projectKey={project.key.toLowerCase()}
          readOnly={readOnly}
        />
      </>
    );
  }

  const serializedRevisions = revisions.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <>
      <SetPageTitle title={page.title} />
      <DocPageEditor
        page={serializedPage}
        initialRevisions={serializedRevisions}
        projectKey={project.key.toLowerCase()}
        projectName={project.name}
        readOnly={readOnly}
      />
    </>
  );
}
