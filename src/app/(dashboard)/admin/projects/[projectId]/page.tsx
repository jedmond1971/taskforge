import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { notFound } from "next/navigation";
import { ChevronLeft, Users } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
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

export default async function AdminProjectDetailPage(
  props: {
    params: Promise<{ projectId: string }>;
  }
) {
  await requireUser();
  const params = await props.params;
  const project = await getAdminProjectDetail(params.projectId);
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <SetPageTitle title={project.name} />

      <Link
        href="/admin/projects"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Projects
      </Link>

      {/* Project header */}
      <div className="bg-surface shadow-[var(--shadow-panel)] rounded-xl p-5">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-foreground">{project.name}</h2>
          {project.isClosed && (
            <span className="text-xs font-medium text-danger bg-danger-soft px-1.5 py-0.5 rounded">
              Closed
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">{project.key}</p>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4 text-sm">
          <div>
            <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Organization</dt>
            <dd className="mt-0.5">
              <Link
                href={`/admin/orgs/${project.org.id}`}
                className="text-foreground hover:underline font-medium"
              >
                {project.org.name}
              </Link>
            </dd>
            <dd className="text-xs text-muted-foreground">{project.org.slug}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Created</dt>
            <dd className="text-foreground mt-0.5">
              {new Date(project.createdAt).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Members</dt>
            <dd className="text-foreground mt-0.5">{project.members.length}</dd>
          </div>
        </dl>
      </div>

      {/* Members */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-2">Users</h3>
        <div className="bg-surface shadow-[var(--shadow-panel)] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-soft">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">User</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {project.members.length === 0 ? (
                <tr>
                  <td colSpan={2}>
                    <EmptyState icon={Users} title="No users." />
                  </td>
                </tr>
              ) : (
                project.members.map((m) => (
                  <tr key={m.user.id} className="hover:bg-surface-active transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="w-7 h-7">
                          <AvatarImage src={m.user.avatarUrl ?? undefined} />
                          <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                            {getInitials(m.user.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium text-foreground">{m.user.name}</p>
                          <p className="text-xs text-muted-foreground">{m.user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={
                        m.role === "PROJECT_LEAD"
                          ? "bg-primary/20 text-primary border-primary/30"
                          : m.role === "TEAM_MEMBER"
                          ? "bg-warning-soft text-warning border-warning/20"
                          : "bg-surface-active text-muted-foreground border-border-soft"
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
