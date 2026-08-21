import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
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

export default async function AdminOrgDetailPage({
  params,
}: {
  params: { orgId: string };
}) {
  const org = await getAdminOrgDetail(params.orgId);
  if (!org) notFound();

  return (
    <div className="space-y-6">
      <SetPageTitle title={org.name} />

      <Link
        href="/admin/orgs"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Organizations
      </Link>

      {/* Org header */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm dark:shadow-none">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{org.name}</h2>
          <Badge className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-700">
            {PLAN_LABELS[org.plan]}
          </Badge>
        </div>
        <p className="text-sm text-zinc-500 mt-1">{org.slug}</p>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4 text-sm">
          <div>
            <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Owner</dt>
            <dd className="text-zinc-900 dark:text-zinc-100 mt-0.5">{org.owner.name}</dd>
            <dd className="text-xs text-zinc-500">{org.owner.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</dt>
            <dd className="text-zinc-900 dark:text-zinc-100 mt-0.5">
              {new Date(org.createdAt).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Members / Projects</dt>
            <dd className="text-zinc-900 dark:text-zinc-100 mt-0.5">
              {org.members.length} / {org.projects.length}
            </dd>
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
              {org.members.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-zinc-500 text-sm">No users.</td>
                </tr>
              ) : (
                org.members.map((m) => (
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
                        m.role === "OWNER"
                          ? "bg-primary/20 text-primary border-primary/30"
                          : m.role === "ADMIN"
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

      {/* Projects */}
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Projects</h3>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm dark:shadow-none">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Project</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Members</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Issues</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {org.projects.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500 text-sm">No projects.</td>
                </tr>
              ) : (
                org.projects.map((project) => (
                  <tr key={project.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/projects/${project.id}`}
                          className="text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:underline"
                        >
                          {project.name}
                        </Link>
                        {project.isClosed && (
                          <span className="text-xs font-medium text-red-500 bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded">
                            Closed
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500">{project.key}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400">{project._count.members}</td>
                    <td className="px-4 py-3 text-sm text-zinc-400">{project._count.issues}</td>
                    <td className="px-4 py-3 text-sm text-zinc-500">
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
