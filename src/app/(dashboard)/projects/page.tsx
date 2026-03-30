import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, GitBranch, Plus } from "lucide-react";
import { NewProjectDialog } from "@/components/projects/NewProjectDialog";

async function getProjects(userId: string) {
  return prisma.project.findMany({
    where: { members: { some: { userId } } },
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

export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const projects = await getProjects(session.user.id);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-100">Projects</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
        </div>
        <NewProjectDialog />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {projects.map((project) => {
          const myRole = project.members[0]?.role;
          return (
            <Link key={project.id} href={`/projects/${project.key}`}>
              <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors cursor-pointer h-full">
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-indigo-700 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-bold text-white">{project.key.slice(0, 2)}</span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{project.name}</h3>
                        <Badge variant="outline" className="text-xs border-zinc-300 dark:border-zinc-700 text-zinc-500 mt-0.5">
                          {project.key}
                        </Badge>
                      </div>
                    </div>
                    {myRole && (
                      <Badge variant="outline" className="text-xs border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 capitalize">
                        {myRole.toLowerCase()}
                      </Badge>
                    )}
                  </div>

                  {project.description && (
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-4 line-clamp-2">{project.description}</p>
                  )}

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
                </CardContent>
              </Card>
            </Link>
          );
        })}

        {/* New project card */}
        <NewProjectDialog trigger={
          <button className="border-2 border-dashed border-zinc-300 dark:border-zinc-800 rounded-xl p-5 flex flex-col items-center justify-center gap-2 hover:border-zinc-400 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors cursor-pointer min-h-[140px] w-full">
            <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
              <Plus className="w-5 h-5 text-zinc-500 dark:text-zinc-400" />
            </div>
            <p className="text-sm text-zinc-500 font-medium">New Project</p>
          </button>
        } />
      </div>
    </div>
  );
}
