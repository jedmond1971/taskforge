"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Plus, ChevronRight } from "lucide-react";
import { CreateIssueDialog } from "@/components/issues/CreateIssueDialog";

function getBreadcrumbs(pathname: string): { label: string; href: string }[] {
  const segments = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href: string }[] = [
    { label: "Dashboard", href: "/" },
  ];

  let currentPath = "";
  for (const segment of segments) {
    currentPath += `/${segment}`;
    const label = segment
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    crumbs.push({ label, href: currentPath });
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
    <header className="h-14 border-b border-zinc-800 bg-zinc-950 flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-2">
        {breadcrumbs.length > 1 && (
          <nav className="flex items-center gap-1 text-sm text-zinc-500">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.href} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3 h-3" />}
                <span
                  className={
                    i === breadcrumbs.length - 1
                      ? "text-zinc-100 font-medium"
                      : "hover:text-zinc-300 cursor-pointer"
                  }
                >
                  {crumb.label}
                </span>
              </span>
            ))}
          </nav>
        )}
        {breadcrumbs.length <= 1 && (
          <h1 className="text-lg font-semibold text-zinc-100">{title}</h1>
        )}
      </div>

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
          className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[0.8rem] font-medium rounded-lg bg-zinc-800 text-zinc-500 cursor-not-allowed"
        >
          <Plus className="w-4 h-4" />
          Create Issue
        </button>
      )}
    </header>
  );
}
