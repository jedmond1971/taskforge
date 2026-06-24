"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IssueForm } from "./IssueForm";
import {
  getProjectMembers,
  getProjectStatuses,
} from "@/app/(dashboard)/projects/[projectKey]/actions";
import { StatusCategory } from "@prisma/client";

type Member = { id: string; name: string; avatarUrl: string | null };
type ProjectStatus = { id: string; name: string; category: StatusCategory };

interface CreateIssueDialogProps {
  projectKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultStatusId?: string;
  parentId?: string | null;
}

export function CreateIssueDialog({
  projectKey,
  open,
  onOpenChange,
  defaultStatusId,
  parentId,
}: CreateIssueDialogProps) {
  const [members, setMembers] = useState<{ user: Member }[]>([]);
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);

  useEffect(() => {
    if (!open) return;
    getProjectMembers(projectKey).then(setMembers).catch(() => setMembers([]));
    getProjectStatuses(projectKey).then(setStatuses).catch(() => setStatuses([]));
  }, [open, projectKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-zinc-900 dark:text-zinc-100">
            {parentId ? "Create Sub-Issue" : "Create Issue"}
          </DialogTitle>
        </DialogHeader>
        <IssueForm
          projectKey={projectKey}
          members={members}
          statuses={statuses}
          defaultStatusId={defaultStatusId}
          parentId={parentId}
          onSuccess={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
