import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Users, FolderKanban, CircleDot } from "lucide-react";

export default async function AdminPage() {
  const [userCount, projectCount, issueCount] = await Promise.all([
    prisma.user.count(),
    prisma.project.count(),
    prisma.issue.count(),
  ]);

  const stats = [
    { label: "Total Users", value: userCount, icon: Users },
    { label: "Total Projects", value: projectCount, icon: FolderKanban },
    { label: "Total Issues", value: issueCount, icon: CircleDot },
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
      href: "/admin/projects",
      title: "Project Management",
      description: "View and manage all projects. Delete projects or review their status.",
      icon: FolderKanban,
      stat: `${projectCount} projects`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex items-center gap-4 shadow-sm dark:shadow-none"
            >
              <div className="w-10 h-10 rounded-lg bg-indigo-600/20 flex items-center justify-center flex-shrink-0">
                <Icon className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{stat.value}</p>
                <p className="text-sm text-zinc-500">{stat.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors group shadow-sm dark:shadow-none"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-indigo-600/20 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-indigo-400" />
                </div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-400 transition-colors">
                  {section.title}
                </h2>
              </div>
              <p className="text-sm text-zinc-500 mb-3">{section.description}</p>
              <p className="text-xs text-zinc-600">{section.stat}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
