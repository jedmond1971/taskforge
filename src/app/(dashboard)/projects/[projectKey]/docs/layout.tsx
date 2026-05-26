import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { canEditIssues, canManageProject } from "@/lib/permissions";
import { ProjectMemberRole } from "@prisma/client";
import { DocsSidebarLayout } from "@/components/docs/docs-sidebar-layout";

async function getDocsSidebarData(projectKey: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase() },
    select: { id: true, key: true, name: true },
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
            select: { id: true, title: true, type: true },
          },
        },
      },
      pages: {
        where: { sectionId: null },
        orderBy: { position: "asc" },
        select: { id: true, title: true, type: true },
      },
    },
  });

  return { project, docSpace, role: member.role as ProjectMemberRole };
}

export default async function DocsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { projectKey: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getDocsSidebarData(params.projectKey, session.user.id);
  if (!data) redirect("/projects");

  const { project, docSpace, role } = data;
  const canEdit = canEditIssues(role);
  const canManage = canManageProject(role);

  const sections = docSpace.sections.map((s) => ({
    id: s.id,
    title: s.title,
    pages: s.pages.map((p) => ({ id: p.id, title: p.title, type: p.type })),
  }));
  const pages = docSpace.pages.map((p) => ({
    id: p.id,
    title: p.title,
    type: p.type,
  }));

  return (
    <DocsSidebarLayout
      projectKey={project.key.toLowerCase()}
      sections={sections}
      pages={pages}
      canEdit={canEdit}
      canManage={canManage}
      isPublic={docSpace.isPublic}
    >
      {children}
    </DocsSidebarLayout>
  );
}
