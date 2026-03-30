import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FolderKanban, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { ActivityFeed } from "@/components/activity/ActivityFeed";

async function getUserProjects(userId: string) {
  return prisma.project.findMany({
    where: {
      members: { some: { userId } },
    },
    include: {
      _count: { select: { members: true, issues: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

async function getAssignedIssues(userId: string) {
  return prisma.issue.findMany({
    where: { assigneeId: userId, status: { not: "DONE" } },
    include: { project: { select: { key: true, name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
}

async function getRecentActivity(userId: string) {
  return prisma.activityLog.findMany({
    where: {
      issue: {
        project: {
          members: { some: { userId } },
        },
      },
    },
    include: {
      user: { select: { id: true, name: true } },
      issue: { select: { key: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}

const statusConfig = {
  TODO: { label: "To Do", color: "bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300", icon: Clock },
  IN_PROGRESS: { label: "In Progress", color: "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300", icon: Clock },
  IN_REVIEW: { label: "In Review", color: "bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300", icon: AlertCircle },
  DONE: { label: "Done", color: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
} as const;

const priorityConfig = {
  CRITICAL: { label: "Critical", color: "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300" },
  HIGH: { label: "High", color: "bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300" },
  MEDIUM: { label: "Medium", color: "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300" },
  LOW: { label: "Low", color: "bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400" },
} as const;

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [projects, assignedIssues, recentActivity] = await Promise.all([
    getUserProjects(session.user.id),
    getAssignedIssues(session.user.id),
    getRecentActivity(session.user.id),
  ]);

  const firstName = session.user.name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Good morning, {firstName} 👋
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 mt-1 text-sm">
          Here&apos;s what&apos;s happening across your projects today.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-600/20 flex items-center justify-center">
                <FolderKanban className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{projects.length}</p>
                <p className="text-xs text-zinc-500">Projects</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-600/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{assignedIssues.length}</p>
                <p className="text-xs text-zinc-500">Assigned to you</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-600/20 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                  {projects.reduce((sum, p) => sum + p._count.issues, 0)}
                </p>
                <p className="text-xs text-zinc-500">Total issues</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Your Projects */}
        <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Your Projects</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {projects.length === 0 ? (
              <p className="text-zinc-500 text-sm py-4 text-center">No projects yet</p>
            ) : (
              projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.key}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-indigo-700 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-white">{project.key.slice(0, 2)}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-zinc-900 dark:group-hover:text-white">{project.name}</p>
                      <p className="text-xs text-zinc-500">{project._count.members} members · {project._count.issues} issues</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400">
                    {project.key}
                  </Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Assigned to You */}
        <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Assigned to You</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {assignedIssues.length === 0 ? (
              <p className="text-zinc-500 text-sm py-4 text-center">Nothing assigned to you</p>
            ) : (
              assignedIssues.map((issue) => {
                const status = statusConfig[issue.status];
                const priority = priorityConfig[issue.priority];
                return (
                  <div
                    key={issue.id}
                    className="flex items-start gap-3 p-3 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-900 dark:text-zinc-100 truncate">{issue.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-zinc-500">{issue.project.key}-{issue.key.split("-")[1]}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${status.color}`}>{status.label}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${priority.color}`}>{priority.label}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityFeed entries={recentActivity} showIssue />
        </CardContent>
      </Card>
    </div>
  );
}
