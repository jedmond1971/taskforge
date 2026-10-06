"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { IssuePriority, IssueType, StatusCategory, SprintStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/issues/StatusBadge";
import { PriorityBadge } from "@/components/issues/PriorityBadge";
import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { MonoMeta } from "@/components/ui/mono-meta";
import { SprintDialog } from "@/components/projects/SprintDialog";
import {
  startSprint,
  completeSprint,
  addIssueToSprint,
  removeIssueFromSprint,
  reorderSprints,
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

type SprintRow = {
  id: string;
  name: string;
  goal: string | null;
  status: SprintStatus;
  startDate: string | null;
  endDate: string | null;
  issues: IssueRow[];
};

// Sprint dates are calendar days stored at UTC midnight, so format them in UTC
// or a western timezone would show the previous day.
function formatSprintDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { timeZone: "UTC" });
}

interface BacklogViewProps {
  projectKey: string;
  /** Open (planned + active) sprints, the active one first. */
  sprints: SprintRow[];
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

function SortableSprint({
  id,
  draggable,
  children,
}: {
  id: string;
  draggable: boolean;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !draggable,
  });
  const handle = draggable ? (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder sprint"
      className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
    >
      <GripVertical size={16} />
    </button>
  ) : null;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      {children(handle)}
    </div>
  );
}

export function BacklogView({
  projectKey,
  sprints: serverSprints,
  backlogIssues,
  canManageSprint: userCanManageSprint,
  canEditIssues: userCanEditIssues,
}: BacklogViewProps) {
  const [isPending, startTransition] = useTransition();
  // `null` = closed, `"new"` = create dialog, otherwise the sprint being edited.
  const [dialogSprint, setDialogSprint] = useState<SprintRow | "new" | null>(null);
  // Optimistic so a dropped sprint stays put while the save is in flight; if the save
  // fails the transition ends and this falls back to the server order.
  const [sprints, setOptimisticSprints] = useOptimistic(serverSprints);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [completeTarget, setCompleteTarget] = useState<SprintRow | null>(null);
  const hasActiveSprint = sprints.some((s) => s.status === "ACTIVE");

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = sprints.findIndex((s) => s.id === active.id);
    const to = sprints.findIndex((s) => s.id === over.id);
    if (from === -1 || to === -1) return;
    const reordered = arrayMove(sprints, from, to);
    startTransition(async () => {
      setOptimisticSprints(reordered);
      const result = await reorderSprints(projectKey, reordered.map((s) => s.id));
      if (!result.success) toast.error(result.error);
    });
  }

  function handleStartSprint(sprintId: string) {
    startTransition(async () => {
      const result = await startSprint(projectKey, sprintId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Sprint started");
    });
  }

  function handleCompleteSprint(sprintId: string) {
    startTransition(async () => {
      const result = await completeSprint(projectKey, sprintId);
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

  function handleAddToSprint(issueId: string, sprintId: string) {
    startTransition(async () => {
      const result = await addIssueToSprint(projectKey, issueId, sprintId);
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
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Sprints</h2>
        {userCanManageSprint && (
          <Button size="sm" onClick={() => setDialogSprint("new")}>
            Create sprint
          </Button>
        )}
      </div>

      {sprints.length === 0 && (
        <div className="rounded-xl bg-surface shadow-[var(--shadow-panel)] p-4">
          <p className="text-sm text-muted-foreground">
            {userCanManageSprint ? "No sprints yet. Create one to start planning." : "No sprint has been created yet."}
          </p>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sprints.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {sprints.map((sprint) => (
            <SortableSprint key={sprint.id} id={sprint.id} draggable={userCanManageSprint && sprints.length > 1}>
              {(handle) => (
                <div className="rounded-xl bg-surface shadow-[var(--shadow-panel)]">
                  <div className="p-4 flex items-start justify-between gap-4 border-b border-border-soft">
                    {handle}
                    <div className="flex-1">
                      <h2 className="text-sm font-semibold text-foreground">{sprint.name}</h2>
                      {sprint.goal && <p className="text-xs text-muted-foreground mt-0.5">{sprint.goal}</p>}
                      <MonoMeta className="mt-1 block">
                        {sprint.status === "PLANNED" ? "Planned" : "Active"}
                        {sprint.startDate && ` • ${formatSprintDate(sprint.startDate)}`}
                        {sprint.endDate && ` – ${formatSprintDate(sprint.endDate)}`}
                      </MonoMeta>
                    </div>
                    {userCanManageSprint && (
                      <Button variant="ghost" onClick={() => setDialogSprint(sprint)} disabled={isPending}>
                        Edit
                      </Button>
                    )}
                    {userCanManageSprint && sprint.status === "PLANNED" && (
                      <Button
                        onClick={() => handleStartSprint(sprint.id)}
                        disabled={isPending || hasActiveSprint}
                        title={hasActiveSprint ? "Complete the active sprint before starting another" : undefined}
                      >
                        Start Sprint
                      </Button>
                    )}
                    {userCanManageSprint && sprint.status === "ACTIVE" && (
                      <Button variant="outline" onClick={() => setCompleteTarget(sprint)} disabled={isPending}>
                        Complete Sprint
                      </Button>
                    )}
                  </div>
                  {sprint.issues.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-4">No issues in this sprint yet.</p>
                  ) : (
                    <div>
                      {sprint.issues.map((issue) => (
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
            </SortableSprint>
          ))}
        </SortableContext>
      </DndContext>

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
                    <select
                      aria-label={`Add ${issue.key} to a sprint`}
                      className="h-7 rounded-lg border border-input bg-transparent px-2 text-xs text-foreground disabled:opacity-50"
                      value=""
                      disabled={isPending || sprints.length === 0}
                      title={sprints.length === 0 ? "Create a sprint first" : undefined}
                      onChange={(e) => e.target.value && handleAddToSprint(issue.id, e.target.value)}
                    >
                      <option value="">Add to sprint…</option>
                      {sprints.map((sprint) => (
                        <option key={sprint.id} value={sprint.id}>
                          {sprint.name}
                        </option>
                      ))}
                    </select>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </div>

      <SprintDialog
        projectKey={projectKey}
        open={dialogSprint !== null}
        onOpenChange={(open) => !open && setDialogSprint(null)}
        sprint={dialogSprint === "new" ? null : dialogSprint}
        sprints={sprints}
      />

      <ConfirmDialog
        open={!!completeTarget}
        onOpenChange={(open) => !open && setCompleteTarget(null)}
        title="Complete this sprint?"
        description="Issues not marked Done will be moved back to the backlog."
        confirmLabel="Complete Sprint"
        variant="destructive"
        onConfirm={() => completeTarget && handleCompleteSprint(completeTarget.id)}
      />
    </>
  );
}
