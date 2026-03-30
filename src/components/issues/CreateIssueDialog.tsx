"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IssueForm } from "./IssueForm";
import { getProjectMembers } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { IssueStatus } from "@prisma/client";

type Member = { id: string; name: string; avatarUrl: string | null };

interface CreateIssueDialogProps {
  projectKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultStatus?: IssueStatus;
}

export function CreateIssueDialog({ projectKey, open, onOpenChange, defaultStatus }: CreateIssueDialogProps) {
  const [members, setMembers] = useState<{ user: Member }[]>([]);

  useEffect(() => {
    if (!open) return;
    getProjectMembers(projectKey).then(setMembers).catch(() => setMembers([]));
  }, [open, projectKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-zinc-900 dark:text-zinc-100">Create Issue</DialogTitle>
        </DialogHeader>
        <IssueForm
          projectKey={projectKey}
          members={members}
          defaultStatus={defaultStatus}
          onSuccess={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
