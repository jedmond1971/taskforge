import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ActivityFeed } from "@/components/activity/ActivityFeed";

async function getProjectActivity(projectKey: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase(), members: { some: { userId } } },
    select: { id: true },
  });
  if (!project) return null;

  const entries = await prisma.activityLog.findMany({
    where: { issue: { projectId: project.id } },
    include: {
      user: { select: { id: true, name: true } },
      issue: { select: { key: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return entries;
}

export default async function ActivityPage({ params }: { params: { projectKey: string } }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const entries = await getProjectActivity(params.projectKey, session.user.id);
  if (!entries) redirect("/projects");

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Activity</h2>
        <p className="text-zinc-500 text-sm">{entries.length} event{entries.length !== 1 ? "s" : ""}</p>
      </div>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
        <ActivityFeed entries={entries} showIssue />
      </div>
    </div>
  );
}
