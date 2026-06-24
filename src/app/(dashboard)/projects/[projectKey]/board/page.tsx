import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { AutoRefresh } from "@/components/layout/AutoRefresh";
import { CATEGORY_ORDER } from "@/lib/issue-utils";
import { StatusCategory } from "@prisma/client";

async function getBoardData(projectKey: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase(), members: { some: { userId } } },
    include: {
      statuses: true,
      issues: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          key: true,
          title: true,
          statusId: true,
          projectStatus: { select: { id: true, name: true, category: true } },
          priority: true,
          type: true,
          position: true,
          dueDate: true,
          assignee: { select: { id: true, name: true, avatarUrl: true } },
        },
      },
    },
  });

  if (!project) return null;

  // Sort statuses: by category order first, then by position within category
  const sortedStatuses = [...project.statuses].sort((a, b) => {
    const catDiff = CATEGORY_ORDER[a.category as StatusCategory] - CATEGORY_ORDER[b.category as StatusCategory];
    return catDiff !== 0 ? catDiff : a.position - b.position;
  });

  // Map projectStatus to the `status` shape expected by KanbanBoard/KanbanCard
  const mappedIssues = project.issues.map((i) => ({
    ...i,
    status: i.projectStatus,
  }));

  return { ...project, statuses: sortedStatuses, issues: mappedIssues };
}

export default async function BoardPage({ params }: { params: { projectKey: string } }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const project = await getBoardData(params.projectKey, session.user.id);
  if (!project) redirect("/projects");

  return (
    <div className="h-full overflow-x-auto">
      <AutoRefresh />
      <KanbanBoard
        initialIssues={project.issues}
        statuses={project.statuses}
        projectKey={params.projectKey}
      />
    </div>
  );
}
