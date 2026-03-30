"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface ProjectNavProps {
  projectKey: string;
}

export function ProjectNav({ projectKey }: ProjectNavProps) {
  const pathname = usePathname();
  const base = `/projects/${projectKey}`;

  const tabs = [
    { href: `${base}/board`, label: "Board" },
    { href: `${base}/issues`, label: "Issues" },
    { href: `${base}/activity`, label: "Activity" },
    { href: `${base}/settings`, label: "Settings" },
  ];

  return (
    <nav className="flex gap-1">
      {tabs.map((tab) => {
        const isActive = pathname.startsWith(tab.href) || (tab.href.endsWith("/board") && pathname === base);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
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
