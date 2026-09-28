"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { IssuePriority, IssueType, StatusCategory, SprintStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/issues/StatusBadge";
import { PriorityBadge } from "@/components/issues/PriorityBadge";
import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { MonoMeta } from "@/components/ui/mono-meta";
import {
  createSprint,
  startSprint,
  completeSprint,
  addIssueToSprint,
  removeIssueFromSprint,
} from "@/app/(dashboard)/projects/[projectKey]/sprint-actions";

type IssueRow = {
  id: string;
  key: string;
  title: string;
  priority: IssuePriority;
  type: IssueType;
  projectStatus: { id: string; name: string; category: StatusCategory };
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
};

type CurrentSprint = {
  id: string;
  name: string;
  goal: string | null;
  status: SprintStatus;
  startDate: string | null;
  issues: IssueRow[];
} | null;

interface BacklogViewProps {
  projectKey: string;
  currentSprint: CurrentSprint;
  backlogIssues: IssueRow[];
  canManageSprint: boolean;
  canEditIssues: boolean;
}

function IssueRowItem({
  issue,
  action,
}: {
  issue: IssueRow;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-border-soft last:border-0">
      <IssueTypeIcon type={issue.type} size={16} />
      <MonoMeta className="flex-shrink-0">{issue.key}</MonoMeta>
      <span className="text-sm text-foreground truncate flex-1">{issue.title}</span>
      <PriorityBadge priority={issue.priority} />
      <StatusBadge status={issue.projectStatus} />
      {issue.assignee ? (
        <span className="text-xs text-muted-foreground flex-shrink-0">{issue.assignee.name}</span>
      ) : (
        <span className="text-xs text-muted-foreground flex-shrink-0">Unassigned</span>
      )}
      {action}
    </div>
  );
}

export function BacklogView({
  projectKey,
  currentSprint,
  backlogIssues,
  canManageSprint: userCanManageSprint,
  canEditIssues: userCanEditIssues,
}: BacklogViewProps) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [confirmCompleteOpen, setConfirmCompleteOpen] = useState(false);

  function handleCreateSprint() {
    if (!name.trim()) {
      toast.error("Sprint name cannot be empty");
      return;
    }
    startTransition(async () => {
      const result = await createSprint(projectKey, { name, goal: goal || undefined });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setName("");
      setGoal("");
      toast.success("Sprint created");
    });
  }

  function handleStartSprint() {
    if (!currentSprint) return;
    startTransition(async () => {
      const result = await startSprint(projectKey, currentSprint.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Sprint started");
    });
  }

  function handleCompleteSprint() {
    if (!currentSprint) return;
    startTransition(async () => {
      const result = await completeSprint(projectKey, currentSprint.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.movedToBacklogCount > 0
          ? `Sprint completed. ${result.movedToBacklogCount} issue${result.movedToBacklogCount === 1 ? "" : "s"} moved back to the backlog.`
          : "Sprint completed."
      );
    });
  }

  function handleAddToSprint(issueId: string) {
    if (!currentSprint) return;
    startTransition(async () => {
      const result = await addIssueToSprint(projectKey, issueId, currentSprint.id);
      if (!result.success) toast.error(result.error);
    });
  }

  function handleRemoveFromSprint(issueId: string) {
    startTransition(async () => {
      const result = await removeIssueFromSprint(projectKey, issueId);
      if (!result.success) toast.error(result.error);
    });
  }

  return (
    <>
      <div className="rounded-xl bg-surface shadow-[var(--shadow-panel)]">
        {!currentSprint && (
          <div className="p-4 space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Current Sprint</h2>
            {userCanManageSprint ? (
              <div className="space-y-2">
                <Input
                  placeholder="Sprint name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="max-w-sm"
                />
                <Input
                  placeholder="Goal (optional)"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  className="max-w-sm"
                />
                <Button onClick={handleCreateSprint} disabled={isPending}>
                  Create Sprint
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No sprint has been created yet.</p>
            )}
          </div>
        )}

        {currentSprint && (
          <div>
            <div className="p-4 flex items-start justify-between gap-4 border-b border-border-soft">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{currentSprint.name}</h2>
                {currentSprint.goal && <p className="text-xs text-muted-foreground mt-0.5">{currentSprint.goal}</p>}
                <MonoMeta className="mt-1 block">
                  {currentSprint.status === "PLANNED" ? "Planned" : "Active"}
                  {currentSprint.startDate && ` • started ${new Date(currentSprint.startDate).toLocaleDateString()}`}
                </MonoMeta>
              </div>
              {userCanManageSprint && currentSprint.status === "PLANNED" && (
                <Button onClick={handleStartSprint} disabled={isPending}>
                  Start Sprint
                </Button>
              )}
              {userCanManageSprint && currentSprint.status === "ACTIVE" && (
                <Button
                  variant="outline"
                  onClick={() => setConfirmCompleteOpen(true)}
                  disabled={isPending}
                >
                  Complete Sprint
                </Button>
              )}
            </div>
            {currentSprint.issues.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">No issues in this sprint yet.</p>
            ) : (
              <div>
                {currentSprint.issues.map((issue) => (
                  <IssueRowItem
                    key={issue.id}
                    issue={issue}
                    action={
                      userCanEditIssues ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveFromSprint(issue.id)}
                          disabled={isPending}
                        >
                          Remove
                        </Button>
                      ) : null
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl bg-surface shadow-[var(--shadow-panel)]">
        <div className="p-4 border-b border-border-soft">
          <h2 className="text-sm font-semibold text-foreground">
            Backlog ({backlogIssues.length})
          </h2>
        </div>
        {backlogIssues.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4">Backlog is empty.</p>
        ) : (
          <div>
            {backlogIssues.map((issue) => (
              <IssueRowItem
                key={issue.id}
                issue={issue}
                action={
                  userCanEditIssues ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleAddToSprint(issue.id)}
                      disabled={isPending || !currentSprint || currentSprint.status === "COMPLETED"}
                      title={!currentSprint ? "Create a sprint first" : undefined}
                    >
                      Add to sprint
                    </Button>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmCompleteOpen}
        onOpenChange={setConfirmCompleteOpen}
        title="Complete this sprint?"
        description="Issues not marked Done will be moved back to the backlog."
        confirmLabel="Complete Sprint"
        variant="destructive"
        onConfirm={handleCompleteSprint}
      />
    </>
  );
}
