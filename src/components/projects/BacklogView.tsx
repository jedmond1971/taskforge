"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
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
import { moveIssueToSprint } from "@/lib/backlog-state";
import { SprintDialog } from "@/components/projects/SprintDialog";
import { SprintCompletionSummary } from "@/components/projects/SprintCompletionSummary";
import { summarizeSprintCompletion } from "@/lib/sprint-completion";
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

// Drag payloads, so one DndContext can tell a sprint being reordered from a backlog issue
// being dropped on a sprint card (JFR-181).
const SPRINT_DRAG = { type: "sprint" } as const;
const issueDragId = (issueId: string) => `issue:${issueId}`;

// An issue is dropped on whichever sprint card the pointer is inside; the keyboard has no
// pointer, so it falls back to the dragged row's overlap. Sprint reordering keeps closestCenter.
const collisionDetection: CollisionDetection = (args) => {
  if (args.active.data.current?.type === "issue") {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : rectIntersection(args);
  }
  return closestCenter(args);
};

// sortableKeyboardCoordinates assumes the dragged item is itself sortable. A backlog issue is
// not, so Up/Down hop between the sprint cards instead (Space drops, Esc cancels).
const issueKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  if (event.code !== "ArrowDown" && event.code !== "ArrowUp") return undefined;
  const cards = context.droppableContainers
    .getEnabled()
    .map((c) => ({ id: c.id, rect: context.droppableRects.get(c.id) }))
    .filter((c): c is { id: typeof c.id; rect: NonNullable<typeof c.rect> } => !!c.rect)
    .sort((a, b) => a.rect.top - b.rect.top);
  if (cards.length === 0) return undefined;
  event.preventDefault();
  const current = cards.findIndex((c) => c.id === context.over?.id);
  const step = event.code === "ArrowDown" ? 1 : -1;
  const target = cards[Math.min(cards.length - 1, Math.max(0, current === -1 ? (step === 1 ? 0 : cards.length - 1) : current + step))];
  return { x: target.rect.left + 16, y: target.rect.top + 8 };
};

const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) =>
  args.context.active?.data.current?.type === "issue"
    ? issueKeyboardCoordinates(event, args)
    : sortableKeyboardCoordinates(event, args);

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
  handle,
  dimmed,
}: {
  issue: IssueRow;
  action: React.ReactNode;
  handle?: React.ReactNode;
  dimmed?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 border-b border-border-soft last:border-0${dimmed ? " opacity-40" : ""}`}>
      {handle}
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

// A backlog row you can lift by its grip. Only the handle starts a drag, so the title and the
// "Add to sprint" select keep working, and keyboard users reach it with Tab.
function DraggableBacklogRow({ issue, action }: { issue: IssueRow; action: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: issueDragId(issue.id),
    data: { type: "issue", issueId: issue.id },
  });
  return (
    <div ref={setNodeRef}>
      <IssueRowItem
        issue={issue}
        action={action}
        dimmed={isDragging}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag ${issue.key} to a sprint`}
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          >
            <GripVertical size={16} />
          </button>
        }
      />
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
  children: (handle: React.ReactNode, isIssueOver: boolean) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver, active } = useSortable({
    id,
    data: SPRINT_DRAG,
    // The card is also the drop target for backlog issues, so it must stay registered even when
    // the sprint itself can't be reordered (a single sprint, or no manage permission).
    disabled: !draggable ? { draggable: true } : false,
  });
  const isIssueOver = isOver && active?.data.current?.type === "issue";
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
      {children(handle, isIssueOver)}
    </div>
  );
}

export function BacklogView({
  projectKey,
  sprints: serverSprints,
  backlogIssues: serverBacklogIssues,
  canManageSprint: userCanManageSprint,
  canEditIssues: userCanEditIssues,
}: BacklogViewProps) {
  const [isPending, startTransition] = useTransition();
  // `null` = closed, `"new"` = create dialog, otherwise the sprint being edited.
  const [dialogSprint, setDialogSprint] = useState<SprintRow | "new" | null>(null);
  // Optimistic so a dropped sprint stays put while the save is in flight; if the save
  // fails the transition ends and this falls back to the server order.
  const [{ sprints, backlogIssues }, setOptimistic] = useOptimistic({
    sprints: serverSprints,
    backlogIssues: serverBacklogIssues,
  });
  const [draggedIssue, setDraggedIssue] = useState<IssueRow | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates })
  );
  // Only the id is kept: the dialog reads the sprint's issues from live state, so its counts follow
  // a refresh (or another user's change) instead of freezing at the moment the button was clicked.
  const [completeTargetId, setCompleteTargetId] = useState<string | null>(null);
  const completeTarget = sprints.find((s) => s.id === completeTargetId) ?? null;
  const completionReturning = completeTarget ? summarizeSprintCompletion(completeTarget.issues).returning.length : 0;
  const hasActiveSprint = sprints.some((s) => s.status === "ACTIVE");

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current;
    setDraggedIssue(data?.type === "issue" ? (backlogIssues.find((i) => i.id === data.issueId) ?? null) : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setDraggedIssue(null);
    if (!over) return;

    if (active.data.current?.type === "issue") {
      // Dropped on a sprint card; the card's droppable id is the sprint id.
      if (userCanEditIssues && sprints.some((s) => s.id === over.id)) {
        handleAddToSprint(String(active.data.current.issueId), String(over.id));
      }
      return;
    }

    if (active.id === over.id) return;
    const from = sprints.findIndex((s) => s.id === active.id);
    const to = sprints.findIndex((s) => s.id === over.id);
    if (from === -1 || to === -1) return;
    const reordered = arrayMove(sprints, from, to);
    startTransition(async () => {
      setOptimistic((prev) => ({ ...prev, sprints: reordered }));
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
      // Optimistic so the row and both counts move at once; a failed save ends the transition
      // and the server state (issue back in the backlog) takes over again.
      setOptimistic((prev) => moveIssueToSprint(prev, issueId, sprintId));
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

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggedIssue(null)}
      >
        <SortableContext items={sprints.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {sprints.map((sprint) => (
            <SortableSprint key={sprint.id} id={sprint.id} draggable={userCanManageSprint && sprints.length > 1}>
              {(handle, isIssueOver) => (
                <div
                  className={`rounded-xl bg-surface shadow-[var(--shadow-panel)] transition-shadow${isIssueOver ? " ring-2 ring-primary" : ""}`}
                >
                  <div className="p-4 flex items-start justify-between gap-4 border-b border-border-soft">
                    {handle}
                    <div className="flex-1">
                      <h2 className="text-sm font-semibold text-foreground">
                        {sprint.name}{" "}
                        <span className="font-normal text-muted-foreground">({sprint.issues.length})</span>
                      </h2>
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
                      <Button variant="outline" onClick={() => setCompleteTargetId(sprint.id)} disabled={isPending}>
                        Complete Sprint
                      </Button>
                    )}
                  </div>
                  {sprint.issues.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-4">
                      No issues in this sprint yet.{userCanEditIssues && backlogIssues.length > 0 ? " Drag one here from the backlog." : ""}
                    </p>
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
            {backlogIssues.map((issue) => {
              const Row = userCanEditIssues && sprints.length > 0 ? DraggableBacklogRow : IssueRowItem;
              return (
              <Row
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
              );
            })}
          </div>
        )}
      </div>

      {/* The floating copy of the row while dragging; the source row dims in place. */}
      <DragOverlay dropAnimation={null}>
        {draggedIssue && (
          <div className="rounded-lg bg-surface shadow-[var(--shadow-overlay)]">
            <IssueRowItem issue={draggedIssue} action={null} />
          </div>
        )}
      </DragOverlay>
      </DndContext>

      <SprintDialog
        projectKey={projectKey}
        open={dialogSprint !== null}
        onOpenChange={(open) => !open && setDialogSprint(null)}
        sprint={dialogSprint === "new" ? null : dialogSprint}
        sprints={sprints}
      />

      <ConfirmDialog
        open={!!completeTarget}
        onOpenChange={(open) => !open && setCompleteTargetId(null)}
        title={completeTarget ? `Complete ${completeTarget.name}?` : "Complete this sprint?"}
        description="Issues that aren't Done go back to the backlog."
        confirmLabel="Complete Sprint"
        // Nothing is moved when every issue is Done, so don't dress it up as a destructive action.
        variant={completionReturning > 0 ? "destructive" : "default"}
        onConfirm={() => completeTarget && handleCompleteSprint(completeTarget.id)}
      >
        {completeTarget && <SprintCompletionSummary issues={completeTarget.issues} />}
      </ConfirmDialog>
    </>
  );
}
