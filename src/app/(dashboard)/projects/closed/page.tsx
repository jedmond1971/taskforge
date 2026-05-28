import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, GitBranch } from "lucide-react";
import { reopenProject } from "../closed-actions";

async function getClosedProjects(userId: string, isAdmin: boolean) {
  if (isAdmin) {
    return prisma.project.findMany({
      where: { isClosed: true },
      include: {
        _count: { select: { members: true, issues: true } },
        members: {
          where: { userId },
          select: { role: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  }
  return prisma.project.findMany({
    where: { isClosed: true, members: { some: { userId } } },
    include: {
      _count: { select: { members: true, issues: true } },
      members: {
        where: { userId },
        select: { role: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export default async function ClosedProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isAdmin = session.user.role === "ADMIN";
  const projects = await getClosedProjects(session.user.id, isAdmin);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-100">Closed Projects</h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          {projects.length} closed project{projects.length !== 1 ? "s" : ""}
        </p>
      </div>

      {projects.length === 0 ? (
        <p className="text-zinc-500 text-sm">No closed projects.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {projects.map((project) => {
            const myRole = project.members[0]?.role;
            return (
              <Card
                key={project.id}
                className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 h-full"
              >
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-zinc-400 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-white">{project.key.slice(0, 2)}</span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{project.name}</h3>
                        <Badge
                          variant="outline"
                          className="text-xs border-zinc-300 dark:border-zinc-700 text-zinc-500 mt-0.5"
                        >
                          {project.key}
                        </Badge>
                      </div>
                    </div>
                    {myRole && (
                      <Badge
                        variant="outline"
                        className="text-xs border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400"
                      >
                        {{ PROJECT_LEAD: "Project Lead", TEAM_MEMBER: "Team Member", VIEWER: "Viewer" }[myRole] ?? myRole}
                      </Badge>
                    )}
                  </div>

                  {project.description && (
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-4 line-clamp-2">
                      {project.description}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 text-zinc-500 text-xs">
                      <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        {project._count.members} member{project._count.members !== 1 ? "s" : ""}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <GitBranch className="w-3.5 h-3.5" />
                        {project._count.issues} issue{project._count.issues !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <form action={reopenProject}>
                      <input type="hidden" name="projectId" value={project.id} />
                      <button
                        type="submit"
                        disabled={!isAdmin}
                        className={
                          isAdmin
                            ? "text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors font-medium"
                            : "text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white font-medium opacity-40 cursor-not-allowed"
                        }
                      >
                        Re-Open This Project
                      </button>
                    </form>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
