"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateIssueDialog } from "@/components/issues/CreateIssueDialog";
import { CREATE_ISSUE_EVENT } from "@/components/layout/CommandPalette";
import { useShortcut } from "@/components/layout/use-shortcut";
import { CHORD_TIMEOUT_MS, GO_CHORD_TARGETS, shouldIgnoreShortcut } from "@/lib/shortcuts";

export function ProjectShortcuts({ projectKey }: { projectKey: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // Set for CHORD_TIMEOUT_MS after "G"; the next B/I/D then navigates.
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useShortcut("n", () => setOpen(true));

  useEffect(() => {
    function clearChord() {
      if (chordTimer.current) clearTimeout(chordTimer.current);
      chordTimer.current = null;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (shouldIgnoreShortcut(e)) return;
      const key = e.key.toLowerCase();
      if (chordTimer.current) {
        clearChord();
        const target = GO_CHORD_TARGETS[key];
        if (target) {
          e.preventDefault();
          router.push(`/projects/${projectKey}/${target}`);
        }
        return;
      }
      if (key === "g") {
        e.preventDefault();
        chordTimer.current = setTimeout(clearChord, CHORD_TIMEOUT_MS);
      }
    }
    function onCreateIssueEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(CREATE_ISSUE_EVENT, onCreateIssueEvent);
    return () => {
      clearChord();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(CREATE_ISSUE_EVENT, onCreateIssueEvent);
    };
  }, [projectKey, router]);

  return (
    <CreateIssueDialog
      projectKey={projectKey}
      open={open}
      onOpenChange={setOpen}
    />
  );
}
