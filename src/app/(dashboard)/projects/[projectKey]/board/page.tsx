import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { KanbanBoard } from "@/components/board/KanbanBoard";

async function getBoardData(projectKey: string, userId: string) {
  return prisma.project.findFirst({
    where: { key: projectKey.toUpperCase(), members: { some: { userId } } },
    include: {
      issues: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          key: true,
          title: true,
          status: true,
          priority: true,
          type: true,
          position: true,
          assignee: { select: { id: true, name: true, avatarUrl: true } },
        },
      },
    },
  });
}

export default async function BoardPage({ params }: { params: { projectKey: string } }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const project = await getBoardData(params.projectKey, session.user.id);
  if (!project) redirect("/projects");

  return (
    <div className="h-full overflow-x-auto">
      <KanbanBoard
        initialIssues={project.issues}
        projectKey={params.projectKey}
      />
    </div>
  );
}
