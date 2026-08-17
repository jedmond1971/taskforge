"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ChevronDown, FolderOpen } from "lucide-react";
import { DocPageStatus } from "@prisma/client";
import { DocTypeIcon } from "@/components/docs/doc-type-icon";
import { DocStatusBadge } from "@/components/docs/doc-status-badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/user-display";

interface ListPage {
  id: string;
  title: string;
  type: string;
  status: DocPageStatus;
  mimeType: string | null;
  updatedAt: Date;
  author: { id: string; name: string; avatarUrl: string | null };
}

interface ListSection {
  id: string;
  title: string;
  pages: ListPage[];
}

interface DocsListBodyProps {
  projectKey: string;
  pages: ListPage[];
  sections: ListSection[];
}

export function DocsListBody({ projectKey, pages, sections }: DocsListBodyProps) {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  function toggleSection(id: string) {
    setCollapsedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="space-y-1">
      {pages.length > 0 && (
        <div className="space-y-1">
          {pages.map((page) => (
            <PageRow key={page.id} page={page} projectKey={projectKey} />
          ))}
        </div>
      )}

      {sections.map((section) => {
        const expanded = !collapsedSections[section.id];
        return (
          <div key={section.id} className="pt-4">
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center gap-2 py-1.5 text-left"
            >
              {expanded ? (
                <ChevronDown className="w-3 h-3 text-zinc-400 transition-transform duration-150 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-zinc-400 transition-transform duration-150 flex-shrink-0" />
              )}
              <FolderOpen className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                {section.title}
              </span>
              <span className="text-xs text-zinc-400">({section.pages.length})</span>
            </button>

            {expanded && (
              section.pages.length === 0 ? (
                <p className="pl-6 py-1 text-sm text-zinc-400 italic">No pages in this section</p>
              ) : (
                <div className="space-y-1">
                  {section.pages.map((page) => (
                    <PageRow key={page.id} page={page} projectKey={projectKey} indent />
                  ))}
                </div>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

function PageRow({
  page,
  projectKey,
  indent = false,
}: {
  page: ListPage;
  projectKey: string;
  indent?: boolean;
}) {
  return (
    <Link
      href={`/projects/${projectKey}/docs/${page.id}`}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors group ${indent ? "ml-5" : ""}`}
    >
      <DocTypeIcon type={page.type} mimeType={page.mimeType} size={16} />
      <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 truncate">
        {page.title}
      </span>
      <DocStatusBadge status={page.status} className="flex-shrink-0" />
      <Avatar size="sm" className="flex-shrink-0">
        <AvatarImage src={page.author.avatarUrl ?? undefined} />
        <AvatarFallback className="bg-primary text-primary-foreground text-[9px] font-semibold">
          {getInitials(page.author.name)}
        </AvatarFallback>
      </Avatar>
      <span className="w-[76px] text-right text-xs text-zinc-400 hidden sm:block flex-shrink-0">
        {new Date(page.updatedAt).toLocaleDateString()}
      </span>
    </Link>
  );
}
