"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  FileText,
  FileArchive,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  BookOpen,
  Lock,
} from "lucide-react";
import { DocsSearchBar } from "./docs-search-bar";
import { DocVisibilityToggle } from "./doc-visibility-toggle";
import { CreateDocItemButtons } from "./create-doc-item-buttons";

interface SidebarPage {
  id: string;
  title: string;
  type: string;
}

interface SidebarSection {
  id: string;
  title: string;
  pages: SidebarPage[];
}

interface DocsSidebarLayoutProps {
  projectKey: string;
  sections: SidebarSection[];
  pages: SidebarPage[];
  canEdit: boolean;
  canManage: boolean;
  isPublic: boolean;
  isClosed?: boolean;
  children: React.ReactNode;
}

export function DocsSidebarLayout({
  projectKey,
  sections,
  pages,
  canEdit,
  canManage,
  isPublic,
  isClosed,
  children,
}: DocsSidebarLayoutProps) {
  const pathname = usePathname();

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(
    () => Object.fromEntries(sections.map((s) => [s.id, true]))
  );

  function toggleSection(id: string) {
    setExpandedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // Extract pageId from pathname: /projects/[key]/docs/[pageId]
  const pathParts = pathname.split("/");
  const activePageId =
    pathParts[1] === "projects" && pathParts[3] === "docs" && pathParts[4]
      ? pathParts[4]
      : null;

  const isDocsHome = pathname === `/projects/${projectKey}/docs`;

  return (
    <div className="flex -m-4 sm:-m-6">
      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 min-h-[calc(100vh-12rem)]">
        {/* Closed banner */}
        {isClosed && (
          <div className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 shrink-0">
            <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Project closed · read-only</span>
          </div>
        )}
        {/* Search */}
        <div className="p-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
          <DocsSearchBar projectKey={projectKey} />
        </div>

        {/* Nav tree */}
        <nav className="flex-1 p-2 space-y-0.5">
          {/* Docs home */}
          <Link
            href={`/projects/${projectKey}/docs`}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
              isDocsHome
                ? "bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 font-medium"
                : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">All pages</span>
          </Link>

          {/* Unsectioned pages */}
          {pages.map((page) => (
            <SidebarPageItem
              key={page.id}
              page={page}
              projectKey={projectKey}
              isActive={activePageId === page.id}
            />
          ))}

          {/* Sections */}
          {sections.map((section) => (
            <div key={section.id} className="pt-1">
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
              >
                {expandedSections[section.id] ? (
                  <ChevronDown className="w-3 h-3 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 flex-shrink-0" />
                )}
                <FolderOpen className="w-3 h-3 flex-shrink-0" />
                <span className="truncate text-left">{section.title}</span>
              </button>

              {expandedSections[section.id] && (
                <div className="ml-4 mt-0.5 space-y-0.5">
                  {section.pages.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-zinc-400 italic">No pages</p>
                  ) : (
                    section.pages.map((page) => (
                      <SidebarPageItem
                        key={page.id}
                        page={page}
                        projectKey={projectKey}
                        isActive={activePageId === page.id}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Footer: create + visibility */}
        {(canEdit || canManage) && (
          <div className="p-3 border-t border-zinc-100 dark:border-zinc-800 shrink-0 space-y-2">
            {canManage && (
              <DocVisibilityToggle
                projectKey={projectKey}
                initialIsPublic={isPublic}
              />
            )}
            {canEdit && (
              <CreateDocItemButtons projectKey={projectKey} variant="sidebar" />
            )}
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 p-4 sm:p-6">
        {children}
      </div>
    </div>
  );
}

function SidebarPageItem({
  page,
  projectKey,
  isActive,
}: {
  page: SidebarPage;
  projectKey: string;
  isActive: boolean;
}) {
  return (
    <Link
      href={`/projects/${projectKey}/docs/${page.id}`}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
        isActive
          ? "bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 font-medium"
          : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
      }`}
    >
      {page.type === "DOCUMENT" ? (
        <FileArchive className="w-3.5 h-3.5 flex-shrink-0 text-zinc-400" />
      ) : (
        <FileText className="w-3.5 h-3.5 flex-shrink-0 text-zinc-400" />
      )}
      <span className="truncate">{page.title}</span>
    </Link>
  );
}
