import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { SetPageTitle } from "@/components/layout/PageTitleContext";
import { getAdminProjectDetail } from "../../actions";
import type { ProjectMemberRole } from "@prisma/client";

const ROLE_LABELS: Record<ProjectMemberRole, string> = {
  PROJECT_LEAD: "Project Lead",
  TEAM_MEMBER: "Team Member",
  VIEWER: "Viewer",
};

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export default async function AdminProjectDetailPage({
  params,
}: {
  params: { projectId: string };
}) {
  const project = await getAdminProjectDetail(params.projectId);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <SetPageTitle title={project.name} />

      <Link
        href="/admin/projects"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Projects
      </Link>

      {/* Project header */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm dark:shadow-none">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{project.name}</h2>
          {project.isClosed && (
            <span className="text-xs font-medium text-red-500 bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded">
              Closed
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-500 mt-1">{project.key}</p>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4 text-sm">
          <div>
            <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Organization</dt>
            <dd className="mt-0.5">
              <Link
                href={`/admin/orgs/${project.org.id}`}
                className="text-zinc-900 dark:text-zinc-100 hover:underline font-medium"
              >
                {project.org.name}
              </Link>
            </dd>
            <dd className="text-xs text-zinc-500">{project.org.slug}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</dt>
            <dd className="text-zinc-900 dark:text-zinc-100 mt-0.5">
              {new Date(project.createdAt).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Members</dt>
            <dd className="text-zinc-900 dark:text-zinc-100 mt-0.5">{project.members.length}</dd>
          </div>
        </dl>
      </div>

      {/* Members */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Users</h3>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm dark:shadow-none">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">User</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {project.members.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-zinc-500 text-sm">No users.</td>
                </tr>
              ) : (
                project.members.map((m) => (
                  <tr key={m.user.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="w-7 h-7">
                          <AvatarImage src={m.user.avatarUrl ?? undefined} />
                          <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                            {getInitials(m.user.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{m.user.name}</p>
                          <p className="text-xs text-zinc-500">{m.user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={
                        m.role === "PROJECT_LEAD"
                          ? "bg-primary/20 text-primary border-primary/30"
                          : m.role === "TEAM_MEMBER"
                          ? "bg-amber-600/20 text-amber-400 border-amber-600/30"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700"
                      }>
                        {ROLE_LABELS[m.role]}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
