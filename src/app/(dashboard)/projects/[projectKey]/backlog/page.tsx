import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AutoRefresh } from "@/components/layout/AutoRefresh";
import { BacklogView } from "@/components/projects/BacklogView";
import { canManageSprint, canEditIssues, getUserGrants } from "@/lib/permissions";

const ISSUE_SELECT = {
  id: true,
  key: true,
  title: true,
  priority: true,
  type: true,
  projectStatus: { select: { id: true, name: true, category: true } },
  assignee: { select: { id: true, name: true, avatarUrl: true } },
} as const;

async function getBacklogData(projectKey: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase(), members: { some: { userId } } },
  });
  if (!project) return null;

  const [currentSprint, backlogIssues] = await Promise.all([
    prisma.sprint.findFirst({
      where: { projectId: project.id, status: { in: ["PLANNED", "ACTIVE"] } },
      include: {
        issues: {
          orderBy: { position: "asc" },
          select: ISSUE_SELECT,
        },
      },
    }),
    prisma.issue.findMany({
      where: { projectId: project.id, sprintId: null },
      orderBy: { createdAt: "desc" },
      select: ISSUE_SELECT,
    }),
  ]);

  return { project, currentSprint, backlogIssues };
}

export default async function BacklogPage({ params }: { params: { projectKey: string } }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getBacklogData(params.projectKey, session.user.id);
  if (!data) redirect("/projects");

  const { project, currentSprint, backlogIssues } = data;

  if (project.workflowMode !== "SPRINT") {
    redirect(`/projects/${params.projectKey}/board`);
  }

  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: session.user.id, projectId: project.id } },
    select: { role: true },
  });
  const grants = await getUserGrants(session.user.id, project.orgId, project.id);
  const userCanManageSprint = member ? canManageSprint(member.role, grants) : false;
  const userCanEditIssues = member ? canEditIssues(member.role, grants) : false;

  return (
    <div className="h-full overflow-y-auto flex flex-col gap-6">
      <AutoRefresh />
      <BacklogView
        projectKey={params.projectKey}
        currentSprint={
          currentSprint
            ? {
                id: currentSprint.id,
                name: currentSprint.name,
                goal: currentSprint.goal,
                status: currentSprint.status,
                startDate: currentSprint.startDate?.toISOString() ?? null,
                issues: currentSprint.issues,
              }
            : null
        }
        backlogIssues={backlogIssues}
        canManageSprint={userCanManageSprint}
        canEditIssues={userCanEditIssues}
      />
    </div>
  );
}
