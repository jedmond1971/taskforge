"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusCategory, IssuePriority } from "@prisma/client";
import { BulkEditIssueList } from "./BulkEditIssueList";
import { BulkEditPanel } from "./BulkEditPanel";

type IssueRow = {
  id: string;
  key: string;
  title: string;
  statusId: string;
  projectStatus: { id: string; name: string; category: StatusCategory };
  priority: IssuePriority;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
};

type ProjectStatus = { id: string; name: string; category: StatusCategory };
type Member = { id: string; name: string; avatarUrl: string | null };

interface BulkEditViewProps {
  issues: IssueRow[];
  statuses: ProjectStatus[];
  members: Member[];
  projectKey: string;
  backHref: string;
}

export function BulkEditView({ issues, statuses, members, projectKey, backHref }: BulkEditViewProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === issues.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(issues.map((i) => i.id)));
    }
  }

  function handleSuccess() {
    setSelectedIds(new Set());
    router.push(backHref);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <BulkEditIssueList
        issues={issues}
        projectKey={projectKey}
        selectedIds={selectedIds}
        onToggle={toggle}
        onToggleAll={toggleAll}
      />
      <BulkEditPanel
        projectKey={projectKey}
        selectedIds={Array.from(selectedIds)}
        statuses={statuses}
        members={members}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
