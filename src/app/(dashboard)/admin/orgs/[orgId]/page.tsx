import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { notFound } from "next/navigation";
import { ChevronLeft, Users, FolderKanban } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { SetPageTitle } from "@/components/layout/PageTitleContext";
import { getAdminOrgDetail } from "../../actions";
import type { Plan, OrgRole } from "@prisma/client";


const PLAN_LABELS: Record<Plan, string> = { FREE: "Free", PRO: "Pro", TEAM: "Team" };
const ROLE_LABELS: Record<OrgRole, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export default async function AdminOrgDetailPage(
  props: {
    params: Promise<{ orgId: string }>;
  }
) {
  await requireUser();
  const params = await props.params;
  const org = await getAdminOrgDetail(params.orgId);
  if (!org) notFound();

  return (
    <div className="space-y-6">
      <SetPageTitle title={org.name} />

      <Link
        href="/admin/orgs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Organizations
      </Link>

      {/* Org header */}
      <div className="bg-surface shadow-[var(--shadow-panel)] rounded-xl p-5">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-foreground">{org.name}</h2>
          <Badge className="bg-surface-active text-muted-foreground border-border-soft">
            {PLAN_LABELS[org.plan]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{org.slug}</p>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4 text-sm">
          <div>
            <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Owner</dt>
            <dd className="text-foreground mt-0.5">{org.owner.name}</dd>
            <dd className="text-xs text-muted-foreground">{org.owner.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Created</dt>
            <dd className="text-foreground mt-0.5">
              {new Date(org.createdAt).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Members / Projects</dt>
            <dd className="text-foreground mt-0.5">
              {org.members.length} / {org.projects.length}
            </dd>
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
              {org.members.length === 0 ? (
                <tr>
                  <td colSpan={2}>
                    <EmptyState icon={Users} title="No users." />
                  </td>
                </tr>
              ) : (
                org.members.map((m) => (
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
                        m.role === "OWNER"
                          ? "bg-primary/20 text-primary border-primary/30"
                          : m.role === "ADMIN"
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

      {/* Projects */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-2">Projects</h3>
        <div className="bg-surface shadow-[var(--shadow-panel)] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-soft">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Project</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Members</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Issues</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {org.projects.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <EmptyState icon={FolderKanban} title="No projects." />
                  </td>
                </tr>
              ) : (
                org.projects.map((project) => (
                  <tr key={project.id} className="hover:bg-surface-active transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/projects/${project.id}`}
                          className="text-sm font-medium text-foreground hover:underline"
                        >
                          {project.name}
                        </Link>
                        {project.isClosed && (
                          <span className="text-xs font-medium text-danger bg-danger-soft px-1.5 py-0.5 rounded">
                            Closed
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{project.key}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{project._count.members}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{project._count.issues}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {new Date(project.createdAt).toLocaleDateString()}
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
