"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, ChevronRight } from "lucide-react";
import { CreateIssueDialog } from "@/components/issues/CreateIssueDialog";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

function segmentLabel(segment: string): string {
  // Issue keys like TF-1, MYPROJECT-42 — preserve as-is
  if (/^[A-Z][A-Z0-9]*-\d+$/.test(segment)) return segment;
  // All-caps project keys like TF, MYPROJECT
  if (/^[A-Z][A-Z0-9]+$/.test(segment)) return segment;
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getBreadcrumbs(pathname: string): { label: string; href: string }[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href: string }[] = [
    { label: "Dashboard", href: "/" },
  ];

  let currentPath = "";
  for (const segment of segments) {
    currentPath += `/${segment}`;
    crumbs.push({ label: segmentLabel(segment), href: currentPath });
  }

  return crumbs;
}

function getPageTitle(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  if (pathname === "/projects") return "Projects";
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && segments[0] === "projects") {
    return segments[1].toUpperCase();
  }
  return segments[segments.length - 1]
    ?.split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") ?? "Page";
}

function getProjectKey(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "projects" && segments[1]) return segments[1].toUpperCase();
  return null;
}

export function Header() {
  const pathname = usePathname();
  const breadcrumbs = getBreadcrumbs(pathname);
  const title = getPageTitle(pathname);
  const projectKey = getProjectKey(pathname);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex items-center justify-between px-3 sm:px-6 flex-shrink-0 gap-2">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {breadcrumbs.length > 1 && (
          <nav className="flex items-center gap-1 text-sm text-zinc-400 dark:text-zinc-500 min-w-0 overflow-hidden">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.href} className="flex items-center gap-1 flex-shrink-0 last:flex-shrink min-w-0">
                {i > 0 && <ChevronRight className="w-3 h-3 flex-shrink-0" />}
                {i === breadcrumbs.length - 1 ? (
                  <span className="truncate text-zinc-900 dark:text-zinc-100 font-medium">
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="truncate hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  >
                    {crumb.label}
                  </Link>
                )}
              </span>
            ))}
          </nav>
        )}
        {breadcrumbs.length <= 1 && (
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 truncate">{title}</h1>
        )}
      </div>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        {projectKey ? (
          <>
            <button
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[0.8rem] font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Issue
            </button>
            <CreateIssueDialog
              projectKey={projectKey}
              open={dialogOpen}
              onOpenChange={setDialogOpen}
            />
          </>
        ) : (
          <button
            disabled
            className="inline-flex items-center gap-1.5 h-9 sm:h-7 px-2.5 text-[0.8rem] font-medium rounded-lg bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-not-allowed flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Create Issue</span>
          </button>
        )}
      </div>
    </header>
  );
}
