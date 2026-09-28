import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { MonoMeta } from "@/components/ui/mono-meta";
import { Users, GitBranch, Plus } from "lucide-react";
import { NewProjectDialog } from "@/components/projects/NewProjectDialog";


async function getProjects(userId: string) {
  return prisma.project.findMany({
    where: { members: { some: { userId } }, isClosed: false },
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
  const session = await requireUser();

  const projects = await getProjects(session.user.id);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} project${projects.length !== 1 ? "s" : ""}`}
        actions={<NewProjectDialog />}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {projects.map((project) => {
          const myRole = project.members[0]?.role;
          return (
            <Link key={project.id} href={`/projects/${project.key}`}>
              <div className="bg-surface rounded-lg p-5 h-full shadow-[var(--shadow-panel)] hover:shadow-[var(--shadow-overlay)] hover:-translate-y-0.5 transition-all duration-150">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary-foreground">{project.key.slice(0, 2)}</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{project.name}</h3>
                      <MonoMeta className="mt-0.5 block">{project.key}</MonoMeta>
                    </div>
                  </div>
                  {myRole && (
                    <Badge variant="outline" className="text-xs">
                      {{ PROJECT_LEAD: "Project Lead", TEAM_MEMBER: "Team Member", VIEWER: "Viewer" }[myRole] ?? myRole}
                    </Badge>
                  )}
                </div>

                {project.description && (
                  <p className="text-muted-foreground text-sm mb-4 line-clamp-2">{project.description}</p>
                )}

                <div className="flex items-center gap-4 text-muted-foreground text-xs">
                  <span className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    {project._count.members} member{project._count.members !== 1 ? "s" : ""}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <GitBranch className="w-3.5 h-3.5" />
                    {project._count.issues} issue{project._count.issues !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}

        {/* New project card */}
        <NewProjectDialog trigger={
          <button className="border-2 border-dashed border-border rounded-xl p-5 flex flex-col items-center justify-center gap-2 hover:bg-surface-active transition-colors cursor-pointer min-h-[140px] w-full">
            <div className="w-10 h-10 rounded-full bg-surface-active flex items-center justify-center">
              <Plus className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground font-medium">New Project</p>
          </button>
        } />
      </div>
    </div>
  );
}
