"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface ProjectNavProps {
  projectKey: string;
  isClosed?: boolean;
  isAdmin?: boolean;
}

export function ProjectNav({ projectKey, isClosed, isAdmin }: ProjectNavProps) {
  const pathname = usePathname();
  const base = `/projects/${projectKey}`;

  const allTabs = [
    { href: `${base}/board`, label: "Board" },
    { href: `${base}/issues`, label: "Issues" },
    { href: `${base}/hierarchy`, label: "Hierarchy" },
    { href: `${base}/docs`, label: "Docs" },
    { href: `${base}/activity`, label: "Activity" },
    { href: `${base}/settings`, label: "Settings" },
  ];

  const tabs = isClosed && !isAdmin
    ? allTabs.filter((t) => t.href === `${base}/docs`)
    : allTabs;

  return (
    <nav className="flex gap-1 overflow-x-auto -mx-6 px-6 scrollbar-none">
      {tabs.map((tab) => {
        const isActive = pathname.startsWith(tab.href) || (tab.href.endsWith("/board") && pathname === base);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap min-h-[44px] flex items-center",
              isActive
                ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
