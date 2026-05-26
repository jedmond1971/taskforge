"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { FileText, File, Plus, X, Search } from "lucide-react";
import { DocPageType } from "@prisma/client";
import { linkDocPage, unlinkDocPage } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { toast } from "sonner";

type LinkedPage = {
  id: string;
  title: string;
  type: DocPageType;
};

type DocLink = {
  id: string;
  pageId: string;
  page: LinkedPage;
};

type AllPage = {
  id: string;
  title: string;
  type: DocPageType;
};

interface RelatedDocsSectionProps {
  issueId: string;
  projectKey: string;
  initialLinks: DocLink[];
  canEdit: boolean;
}

function PageTypeIcon({ type }: { type: DocPageType }) {
  return type === "DOCUMENT" ? (
    <File className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
  ) : (
    <FileText className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
  );
}

function LinkPickerDialog({
  projectKey,
  linkedPageIds,
  onLink,
  onClose,
}: {
  projectKey: string;
  linkedPageIds: Set<string>;
  onLink: (page: AllPage) => void;
  onClose: () => void;
}) {
  const [pages, setPages] = useState<AllPage[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/docs/${projectKey}/pages`)
      .then((r) => r.json())
      .then((data: { pages?: AllPage[] }) => setPages(data.pages ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectKey]);

  const filtered = pages.filter(
    (p) =>
      !linkedPageIds.has(p.id) &&
      p.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Link a doc page</h3>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg">
            <Search className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pages…"
              className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 outline-none"
            />
          </div>
        </div>

        <div className="px-2 pb-3 max-h-64 overflow-y-auto">
          {loading ? (
            <p className="text-center text-sm text-zinc-400 py-6">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-zinc-400 py-6">
              {pages.length === 0 ? "No pages in this project yet." : "No matching pages."}
            </p>
          ) : (
            filtered.map((page) => (
              <button
                key={page.id}
                onClick={() => onLink(page)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left"
              >
                <PageTypeIcon type={page.type} />
                <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate">{page.title}</span>
                <span className="ml-auto text-xs text-zinc-400 shrink-0">
                  {page.type === "DOCUMENT" ? "Document" : "Page"}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function RelatedDocsSection({
  issueId,
  projectKey,
  initialLinks,
  canEdit,
}: RelatedDocsSectionProps) {
  const [links, setLinks] = useState<DocLink[]>(initialLinks);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Keep in sync when the server refreshes the parent
  useEffect(() => {
    setLinks(initialLinks);
  }, [initialLinks]);

  function handleLink(page: AllPage) {
    setPickerOpen(false);
    const optimistic: DocLink = {
      id: `temp-${page.id}`,
      pageId: page.id,
      page,
    };
    setLinks((prev) => [...prev, optimistic]);
    startTransition(async () => {
      try {
        await linkDocPage(projectKey, issueId, page.id);
        toast.success("Doc page linked");
      } catch {
        setLinks((prev) => prev.filter((l) => l.pageId !== page.id));
        toast.error("Failed to link page");
      }
    });
  }

  function handleUnlink(pageId: string) {
    setLinks((prev) => prev.filter((l) => l.pageId !== pageId));
    startTransition(async () => {
      try {
        await unlinkDocPage(projectKey, issueId, pageId);
        toast.success("Link removed");
      } catch {
        toast.error("Failed to remove link");
      }
    });
  }

  const linkedPageIds = new Set(links.map((l) => l.pageId));

  return (
    <>
      {pickerOpen && (
        <LinkPickerDialog
          projectKey={projectKey}
          linkedPageIds={linkedPageIds}
          onLink={handleLink}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Related Docs
            {links.length > 0 && (
              <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-600 bg-zinc-100 dark:bg-zinc-800 rounded px-1.5 py-0.5 font-mono">
                {links.length}
              </span>
            )}
          </h3>
          {canEdit && (
            <button
              onClick={() => setPickerOpen(true)}
              disabled={isPending}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Link a doc page
            </button>
          )}
        </div>

        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          {links.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-600 italic px-3 py-3">
              No related docs.{canEdit ? " Click \"Link a doc page\" to attach one." : ""}
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {links.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center gap-2.5 px-3 py-2 group"
                >
                  <PageTypeIcon type={link.page.type} />
                  <Link
                    href={`/projects/${projectKey}/docs/${link.page.id}`}
                    className="flex-1 text-sm text-zinc-700 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline truncate"
                  >
                    {link.page.title}
                  </Link>
                  <span className="text-xs text-zinc-400 shrink-0">
                    {link.page.type === "DOCUMENT" ? "Document" : "Page"}
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => handleUnlink(link.pageId)}
                      disabled={isPending}
                      className="p-0.5 text-zinc-300 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                      title="Remove link"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
