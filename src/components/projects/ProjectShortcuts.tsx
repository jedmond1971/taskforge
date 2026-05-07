"use client";

import { useEffect, useState } from "react";
import { CreateIssueDialog } from "@/components/issues/CreateIssueDialog";

export function ProjectShortcuts({ projectKey }: { projectKey: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "n" && e.key !== "N") return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      e.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <CreateIssueDialog
      projectKey={projectKey}
      open={open}
      onOpenChange={setOpen}
    />
  );
}
