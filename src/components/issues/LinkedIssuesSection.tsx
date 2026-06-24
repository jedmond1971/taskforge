"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import Link from "next/link";
import { Plus, X, Search, Link2 } from "lucide-react";
import { IssueLinkType, StatusCategory } from "@prisma/client";
import {
  linkIssue,
  unlinkIssue,
  searchIssuesForLinking,
} from "@/app/(dashboard)/projects/[projectKey]/actions";
import { StatusBadge } from "@/components/issues/StatusBadge";
import { toast } from "sonner";

type LinkedIssueStatus = { id: string; name: string; category: StatusCategory };

type LinkedIssue = {
  id: string;
  key: string;
  title: string;
  projectStatus: LinkedIssueStatus;
};

type IssueLink = {
  id: string;
  linkType: IssueLinkType;
  // For outgoing links: targetIssue; for incoming links: sourceIssue
  issue: LinkedIssue;
  // Direction determines the label
  direction: "outgoing" | "incoming";
};

interface LinkedIssuesSectionProps {
  issueId: string;
  projectKey: string;
  initialOutgoing: Array<{
    id: string;
    linkType: IssueLinkType;
    targetIssue: LinkedIssue;
  }>;
  initialIncoming: Array<{
    id: string;
    linkType: IssueLinkType;
    sourceIssue: LinkedIssue;
  }>;
  canEdit: boolean;
}

function relationshipLabel(linkType: IssueLinkType, direction: "outgoing" | "incoming"): string {
  if (linkType === "RELATES_TO") return "Relates to";
  if (direction === "outgoing") return "Blocks";
  return "Is blocked by";
}

function relationshipChipColor(linkType: IssueLinkType, direction: "outgoing" | "incoming") {
  if (linkType === "RELATES_TO") return "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400";
  if (direction === "outgoing") return "bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400";
  return "bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400";
}

function normalize(outgoing: LinkedIssuesSectionProps["initialOutgoing"], incoming: LinkedIssuesSectionProps["initialIncoming"]): IssueLink[] {
  return [
    ...outgoing.map((l) => ({ id: l.id, linkType: l.linkType, issue: l.targetIssue, direction: "outgoing" as const })),
    ...incoming.map((l) => ({ id: l.id, linkType: l.linkType, issue: l.sourceIssue, direction: "incoming" as const })),
  ];
}

function IssueLinkPickerDialog({
  issueId,
  projectKey,
  existingLinkIssueIds,
  onLink,
  onClose,
}: {
  issueId: string;
  projectKey: string;
  existingLinkIssueIds: Set<string>;
  onLink: (issue: LinkedIssue, linkType: IssueLinkType) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkedIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkType, setLinkType] = useState<IssueLinkType>("RELATES_TO");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const issues = await searchIssuesForLinking(projectKey, query, issueId);
        setResults(issues.filter((i) => !existingLinkIssueIds.has(i.id)));
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, projectKey, issueId, existingLinkIssueIds]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Link an issue</h3>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          {/* Relationship type selector */}
          <div className="flex gap-2">
            {(["RELATES_TO", "BLOCKS"] as IssueLinkType[]).map((type) => (
              <button
                key={type}
                onClick={() => setLinkType(type)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  linkType === type
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300"
                    : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-zinc-600"
                }`}
              >
                {type === "RELATES_TO" ? "Relates to" : "Blocks"}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg">
            <Search className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by key or title…"
              className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 outline-none"
            />
          </div>
        </div>

        <div className="px-2 pb-3 max-h-64 overflow-y-auto">
          {loading ? (
            <p className="text-center text-sm text-zinc-400 py-6">Searching…</p>
          ) : !query.trim() ? (
            <p className="text-center text-sm text-zinc-400 py-6">Type to search for an issue.</p>
          ) : results.length === 0 ? (
            <p className="text-center text-sm text-zinc-400 py-6">No matching issues found.</p>
          ) : (
            results.map((issue) => (
              <button
                key={issue.id}
                onClick={() => onLink(issue, linkType)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left"
              >
                <span className="text-xs font-mono text-zinc-400 shrink-0">{issue.key}</span>
                <span className="text-sm text-zinc-700 dark:text-zinc-300 flex-1 truncate">{issue.title}</span>
                <StatusBadge status={issue.projectStatus} className="shrink-0" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function LinkedIssuesSection({
  issueId,
  projectKey,
  initialOutgoing,
  initialIncoming,
  canEdit,
}: LinkedIssuesSectionProps) {
  const [links, setLinks] = useState<IssueLink[]>(() => normalize(initialOutgoing, initialIncoming));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setLinks(normalize(initialOutgoing, initialIncoming));
  }, [initialOutgoing, initialIncoming]);

  function handleLink(issue: LinkedIssue, linkType: IssueLinkType) {
    setPickerOpen(false);
    const optimisticLink: IssueLink = {
      id: `temp-${issue.id}`,
      linkType,
      issue,
      direction: "outgoing",
    };
    setLinks((prev) => [...prev, optimisticLink]);
    startTransition(async () => {
      try {
        await linkIssue(projectKey, issueId, issue.id, linkType);
        toast.success("Issue linked");
      } catch {
        setLinks((prev) => prev.filter((l) => l.id !== optimisticLink.id));
        toast.error("Failed to link issue");
      }
    });
  }

  function handleUnlink(linkId: string) {
    setLinks((prev) => prev.filter((l) => l.id !== linkId));
    startTransition(async () => {
      try {
        await unlinkIssue(projectKey, linkId);
        toast.success("Link removed");
      } catch {
        toast.error("Failed to remove link");
      }
    });
  }

  const existingLinkIssueIds = new Set(links.map((l) => l.issue.id));

  return (
    <>
      {pickerOpen && (
        <IssueLinkPickerDialog
          issueId={issueId}
          projectKey={projectKey}
          existingLinkIssueIds={existingLinkIssueIds}
          onLink={handleLink}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Linked Issues
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
              Link an issue
            </button>
          )}
        </div>

        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          {links.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-zinc-600 italic px-3 py-3">
              No linked issues.{canEdit ? " Click \"Link an issue\" to add one." : ""}
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {links.map((link) => (
                <div key={link.id} className="flex items-center gap-2.5 px-3 py-2 group">
                  <Link2 className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 flex-shrink-0" />
                  <span
                    className={`text-xs font-medium px-1.5 py-0.5 rounded shrink-0 ${relationshipChipColor(link.linkType, link.direction)}`}
                  >
                    {relationshipLabel(link.linkType, link.direction)}
                  </span>
                  <Link
                    href={`/projects/${projectKey}/issues/${link.issue.key}`}
                    className="text-xs font-mono text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 shrink-0"
                  >
                    {link.issue.key}
                  </Link>
                  <Link
                    href={`/projects/${projectKey}/issues/${link.issue.key}`}
                    className="flex-1 text-sm text-zinc-700 dark:text-zinc-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline truncate"
                  >
                    {link.issue.title}
                  </Link>
                  <StatusBadge status={link.issue.projectStatus} className="shrink-0" />
                  {canEdit && (
                    <button
                      onClick={() => handleUnlink(link.id)}
                      disabled={isPending || link.id.startsWith("temp-")}
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
