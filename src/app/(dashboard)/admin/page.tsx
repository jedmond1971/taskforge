import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import Link from "next/link";
import { Users, FolderKanban, CircleDot, Building2, Mail, ScrollText } from "lucide-react";


export default async function AdminPage() {
  await requireUser();
  const [userCount, projectCount, issueCount, orgCount, pendingInviteCount] = await Promise.all([
    prisma.user.count(),
    prisma.project.count(),
    prisma.issue.count(),
    prisma.organization.count(),
    prisma.orgInvite.count({ where: { accepted: false, expiresAt: { gt: new Date() } } }),
  ]);

  const stats = [
    { label: "Total Users", value: userCount, icon: Users },
    { label: "Organizations", value: orgCount, icon: Building2 },
    { label: "Total Projects", value: projectCount, icon: FolderKanban },
    { label: "Total Issues", value: issueCount, icon: CircleDot },
    { label: "Pending Invites", value: pendingInviteCount, icon: Mail },
  ];

  const sections = [
    {
      href: "/admin/users",
      title: "User Management",
      description: "Create, edit, and manage user accounts and roles across the platform.",
      icon: Users,
      stat: `${userCount} users`,
    },
    {
      href: "/admin/orgs",
      title: "Organization Management",
      description: "Create and manage organizations. Add or remove members and assign roles.",
      icon: Building2,
      stat: `${orgCount} orgs`,
    },
    {
      href: "/admin/projects",
      title: "Project Management",
      description: "View and manage all projects. Delete projects or review their status.",
      icon: FolderKanban,
      stat: `${projectCount} projects`,
    },
    {
      href: "/admin/invites",
      title: "Invite Management",
      description: "Send and manage organization invites.",
      icon: Mail,
      stat: `${pendingInviteCount} pending`,
    },
    {
      href: "/admin/audit-log",
      title: "Audit Log",
      description: "Permanent record of all admin actions — user, org, project, and invite changes.",
      icon: ScrollText,
      stat: "Admin writes only",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-surface shadow-[var(--shadow-panel)] rounded-xl p-4 flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              className="bg-surface shadow-[var(--shadow-panel)] rounded-xl p-6 hover:bg-surface-active transition-colors group"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h2 className="text-lg font-semibold text-foreground group-hover:text-primary/80 transition-colors">
                  {section.title}
                </h2>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{section.description}</p>
              <p className="font-mono text-xs text-muted-foreground">{section.stat}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
