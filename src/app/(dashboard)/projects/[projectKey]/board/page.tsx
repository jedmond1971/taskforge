import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { AutoRefresh } from "@/components/layout/AutoRefresh";
import { CATEGORY_ORDER } from "@/lib/issue-utils";
import { StatusCategory } from "@prisma/client";

const ISSUE_SELECT = {
  id: true,
  key: true,
  title: true,
  statusId: true,
  projectStatus: { select: { id: true, name: true, category: true } },
  priority: true,
  type: true,
  position: true,
  dueDate: true,
  statusChangedAt: true,
  assignee: { select: { id: true, name: true, avatarUrl: true } },
} as const;

async function getBoardData(projectKey: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase(), members: { some: { userId } } },
    include: { statuses: true },
  });

  if (!project) return null;

  let activeSprintId: string | null = null;
  if (project.workflowMode === "SPRINT") {
    const activeSprint = await prisma.sprint.findFirst({
      where: { projectId: project.id, status: "ACTIVE" },
      select: { id: true },
    });
    activeSprintId = activeSprint?.id ?? null;
  }

  const issues = await prisma.issue.findMany({
    where: {
      projectId: project.id,
      // Sprint mode with no active sprint yet: "__none__" can never match a
      // real cuid, so this naturally returns an empty list — one code path
      // instead of a separate early return.
      ...(project.workflowMode === "SPRINT" ? { sprintId: activeSprintId ?? "__none__" } : {}),
    },
    orderBy: { position: "asc" },
    select: ISSUE_SELECT,
  });

  // Sort statuses: by category order first, then by position within category
  const sortedStatuses = [...project.statuses].sort((a, b) => {
    const catDiff = CATEGORY_ORDER[a.category as StatusCategory] - CATEGORY_ORDER[b.category as StatusCategory];
    return catDiff !== 0 ? catDiff : a.position - b.position;
  });

  // Map projectStatus to the `status` shape expected by KanbanBoard/KanbanCard
  const mappedIssues = issues.map((i) => ({
    ...i,
    status: i.projectStatus,
  }));

  const cutoff = project.doneAutoHideDays
    ? new Date(Date.now() - project.doneAutoHideDays * 24 * 60 * 60 * 1000)
    : null;

  const visibleIssues = cutoff
    ? mappedIssues.filter(
        (i) => i.status.category !== "DONE" || i.statusChangedAt > cutoff
      )
    : mappedIssues;

  return { ...project, statuses: sortedStatuses, issues: visibleIssues, activeSprintId };
}

export default async function BoardPage({ params }: { params: { projectKey: string } }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const project = await getBoardData(params.projectKey, session.user.id);
  if (!project) redirect("/projects");

  if (project.workflowMode === "SPRINT" && !project.activeSprintId) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-2">
        <AutoRefresh />
        <p className="text-zinc-500">No active sprint.</p>
        <Link
          href={`/projects/${params.projectKey}/backlog`}
          className="text-primary text-sm font-medium hover:underline"
        >
          Go to the Backlog to start one
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full overflow-x-auto flex flex-col">
      <AutoRefresh />
      <KanbanBoard
        initialIssues={project.issues}
        statuses={project.statuses}
        projectKey={params.projectKey}
        sprintScopeId={project.workflowMode === "SPRINT" ? project.activeSprintId! : undefined}
      />
    </div>
  );
}
