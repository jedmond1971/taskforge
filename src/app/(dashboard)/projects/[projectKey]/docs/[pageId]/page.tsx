import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect, notFound } from "next/navigation";
import { DocPageEditor } from "@/components/docs/doc-page-editor";
import { DocDocumentView } from "@/components/docs/doc-document-view";

async function getPageData(projectKey: string, pageId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: {
      key: projectKey.toUpperCase(),
      members: { some: { userId } },
    },
    select: { id: true, key: true, name: true },
  });
  if (!project) return null;

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

  return { project, page, revisions };
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

  const { project, page, revisions } = data;

  const serializedPage = {
    ...page,
    updatedAt: page.updatedAt.toISOString(),
    createdAt: page.createdAt.toISOString(),
  };

  if (page.type === "DOCUMENT") {
    return (
      <DocDocumentView
        page={serializedPage}
        projectKey={project.key.toLowerCase()}
      />
    );
  }

  const serializedRevisions = revisions.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <DocPageEditor
      page={serializedPage}
      initialRevisions={serializedRevisions}
      projectKey={project.key.toLowerCase()}
      projectName={project.name}
    />
  );
}
