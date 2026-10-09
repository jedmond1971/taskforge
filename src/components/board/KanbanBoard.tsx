"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type Announcements,
  type CollisionDetection,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { StatusCategory, IssuePriority, IssueType } from "@prisma/client";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard } from "./KanbanCard";
import { moveIssue, reorderIssues, updateIssue } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { toast } from "sonner";
import { boardSignature, markBoardWrite, msSinceBoardWrite, setBoardBusy } from "@/lib/board-activity";

type BoardStatus = {
  id: string;
  name: string;
  category: StatusCategory;
  position: number;
};

export type BoardMember = { id: string; name: string; avatarUrl: string | null };

type CardIssue = {
  id: string;
  key: string;
  title: string;
  statusId: string;
  status: { id: string; name: string; category: StatusCategory };
  priority: IssuePriority;
  type: IssueType;
  position: number;
  dueDate?: Date | null;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
};

interface KanbanBoardProps {
  initialIssues: CardIssue[];
  statuses: BoardStatus[];
  projectKey: string;
  // Project members for the card's assignee quick-action, and whether this user may edit issues.
  members?: BoardMember[];
  canEdit?: boolean;
  // Set only for Sprint-mode boards, scoped to the active sprint's id — see
  // moveIssue/reorderIssues's sprintScopeId doc in actions.ts.
  sprintScopeId?: string;
}

// A refresh landing this soon after our own move/reorder is that move's echo, not news.
const OWN_WRITE_ECHO_MS = 8000;

// Custom collision detection: prefer column droppables for cross-column detection
const customCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

export function KanbanBoard({ initialIssues, statuses, projectKey, members = [], canEdit = false, sprintScopeId }: KanbanBoardProps) {
  const [issues, setIssues] = useState<CardIssue[]>(initialIssues);
  const [activeIssue, setActiveIssue] = useState<CardIssue | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Where the dragged card started, so a completed cross-column move can be undone.
  const dragOrigin = useRef<{ statusId: string; index: number } | null>(null);

  const statusIds = new Set(statuses.map((s) => s.id));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Screen-reader narration for keyboard/pointer drags: pick-up, move, drop, cancel.
  const announcements: Announcements = {
    onDragStart({ active }) {
      const issue = issues.find((i) => i.id === active.id);
      if (!issue) return undefined;
      const col = byColumn(issue.statusId);
      return `Picked up ${issue.key}, ${issue.title}. It is in ${issue.status.name}, position ${
        col.findIndex((i) => i.id === issue.id) + 1
      } of ${col.length}.`;
    },
    onDragOver({ active, over }) {
      const issue = issues.find((i) => i.id === active.id);
      if (!issue || !over) return undefined;
      const colId = resolveColumnId(String(over.id));
      const status = statuses.find((s) => s.id === colId);
      if (!status) return undefined;
      const col = byColumn(status.id);
      const idx = col.findIndex((i) => i.id === String(over.id));
      return `${issue.key} is over ${status.name}${idx === -1 ? "" : `, position ${idx + 1} of ${col.length}`}.`;
    },
    onDragEnd({ active, over }) {
      const issue = issues.find((i) => i.id === active.id);
      if (!issue) return undefined;
      const status = over && statuses.find((s) => s.id === resolveColumnId(String(over.id)));
      return status ? `Dropped ${issue.key} in ${status.name}.` : `Dropped ${issue.key}. No change.`;
    },
    onDragCancel({ active }) {
      const issue = issues.find((i) => i.id === active.id);
      return issue ? `Move cancelled. ${issue.key} returned to ${issue.status.name}.` : undefined;
    },
  };

  const screenReaderInstructions = {
    draggable:
      "To pick up an issue, press space or enter. Use the arrow keys to move it between and within columns, space or enter to drop it, and escape to cancel.",
  };

  function handleQuickUpdate(
    issue: Pick<CardIssue, "id" | "key">,
    updates: { priority?: IssuePriority; assigneeId?: string | null }
  ) {
    const previous = issues;
    setIssues((prev) =>
      prev.map((i) => {
        if (i.id !== issue.id) return i;
        const next = { ...i };
        if (updates.priority) next.priority = updates.priority;
        if ("assigneeId" in updates) {
          next.assignee = members.find((m) => m.id === updates.assigneeId) ?? null;
        }
        return next;
      })
    );
    setIsSaving(true);
    markBoardWrite();
    updateIssue(projectKey, issue.id, updates)
      .then(() => toast.success(`${issue.key} updated`))
      .catch(() => {
        setIssues(previous);
        toast.error(`Failed to update ${issue.key}`);
      })
      .finally(() => {
        markBoardWrite();
        setIsSaving(false);
      });
  }

  // AutoRefresh holds off while a card is being dragged or a move is still saving.
  useEffect(() => {
    setBoardBusy(activeIssue !== null || isSaving);
  }, [activeIssue, isSaving]);
  useEffect(() => () => setBoardBusy(false), []);

  // Fingerprint of the last server data we synced, and when this user last wrote — together they
  // tell a change from someone else (worth a "Board updated" pill) from the echo of our own move.
  const syncedSignature = useRef(boardSignature(initialIssues));

  // Sync server-refreshed issues into local state, but not while a drag is in flight
  useEffect(() => {
    if (activeIssue) return;
    setIssues(initialIssues);
    const signature = boardSignature(initialIssues);
    if (signature === syncedSignature.current) return;
    syncedSignature.current = signature;
    if (msSinceBoardWrite() > OWN_WRITE_ECHO_MS) {
      toast("Board updated", { id: "board-updated", duration: 2500 });
    }
  }, [initialIssues]); // eslint-disable-line react-hooks/exhaustive-deps

  // Group issues by statusId, sorted by position
  const byColumn = useCallback(
    (statusId: string) =>
      issues
        .filter((i) => i.statusId === statusId)
        .sort((a, b) => a.position - b.position),
    [issues]
  );

  // Resolve the statusId for the column being hovered (either the column itself or a card's column)
  function resolveColumnId(overId: string): string | undefined {
    if (statusIds.has(overId)) return overId;
    const hovered = issues.find((i) => i.id === overId);
    return hovered?.statusId;
  }

  function handleDragStart({ active }: DragStartEvent) {
    const issue = issues.find((i) => i.id === active.id);
    setActiveIssue(issue ?? null);
    dragOrigin.current = issue
      ? { statusId: issue.statusId, index: byColumn(issue.statusId).findIndex((i) => i.id === issue.id) }
      : null;
  }

  function saveMove(
    issue: CardIssue,
    dest: BoardStatus,
    position: number,
    undoTo?: { statusId: string; index: number },
    isUndo = false
  ) {
    setIssues((prev) =>
      prev.map((i) =>
        i.id === issue.id
          ? { ...i, statusId: dest.id, status: { id: dest.id, name: dest.name, category: dest.category }, position }
          : i
      )
    );

    setIsSaving(true);
    markBoardWrite();
    moveIssue(projectKey, issue.id, dest.id, position, sprintScopeId)
      .then(() => {
        if (isUndo) {
          toast.success("Move undone");
          return;
        }
        const origin = undoTo && statuses.find((s) => s.id === undoTo.statusId);
        toast.success(`${issue.key} moved to ${dest.name}`, {
          action:
            origin && undoTo
              ? { label: "Undo", onClick: () => saveMove(issue, origin, undoTo.index, undefined, true) }
              : undefined,
        });
      })
      .catch(() => {
        setIssues(initialIssues);
        toast.error("Failed to move issue", {
          action: { label: "Retry", onClick: () => saveMove(issue, dest, position, undoTo, isUndo) },
        });
      })
      .finally(() => {
        markBoardWrite();
        setIsSaving(false);
      });
  }

  function saveReorder(orderedIds: string[], destStatusId: string) {
    setIssues((prev) => {
      const byId = new Map(prev.map((i) => [i.id, i]));
      const others = prev.filter((i) => i.statusId !== destStatusId);
      const updated = orderedIds.flatMap((id, idx) => {
        const issue = byId.get(id);
        return issue ? [{ ...issue, position: idx }] : [];
      });
      return [...others, ...updated];
    });

    setIsSaving(true);
    markBoardWrite();
    reorderIssues(projectKey, orderedIds, sprintScopeId)
      .catch(() => {
        setIssues(initialIssues);
        toast.error("Failed to reorder issues", {
          action: { label: "Retry", onClick: () => saveReorder(orderedIds, destStatusId) },
        });
      })
      .finally(() => {
        markBoardWrite();
        setIsSaving(false);
      });
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    setOverId(over?.id ? String(over.id) : null);
    if (!over || active.id === over.id) return;

    const activeIssueItem = issues.find((i) => i.id === active.id);
    if (!activeIssueItem) return;

    const destStatusId = resolveColumnId(String(over.id));
    if (!destStatusId || destStatusId === activeIssueItem.statusId) return;

    const destStatus = statuses.find((s) => s.id === destStatusId);
    if (!destStatus) return;

    // Optimistically move the card to the new column
    setIssues((prev) =>
      prev.map((i) =>
        i.id === activeIssueItem.id
          ? { ...i, statusId: destStatusId, status: { id: destStatus.id, name: destStatus.name, category: destStatus.category } }
          : i
      )
    );
  }

  function handleDragEnd({ over }: DragEndEvent) {
    const draggedIssue = activeIssue;
    setActiveIssue(null);
    setOverId(null);

    if (!over || !draggedIssue) return;

    const destStatusId = resolveColumnId(String(over.id)) ?? draggedIssue.statusId;
    const destColumn = issues
      .filter((i) => i.statusId === destStatusId)
      .sort((a, b) => a.position - b.position);

    if (destStatusId !== draggedIssue.statusId) {
      // Cross-column move
      const overIndex = destColumn.findIndex((i) => i.id === String(over.id));
      const newPosition = overIndex === -1 ? destColumn.length : overIndex;

      const destStatus = statuses.find((s) => s.id === destStatusId);
      if (!destStatus) return;

      saveMove(draggedIssue, destStatus, newPosition, dragOrigin.current ?? undefined);
    } else {
      // Within-column reorder
      const oldIndex = destColumn.findIndex((i) => i.id === draggedIssue.id);
      const newIndex = destColumn.findIndex((i) => i.id === String(over.id));

      if (oldIndex === newIndex) return;

      const reordered = arrayMove(destColumn, oldIndex, newIndex);
      saveReorder(reordered.map((i) => i.id), destStatusId);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={customCollision}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div
        role="region"
        aria-label="Kanban board"
        className="flex gap-3 sm:gap-4 overflow-x-auto scrollbar-thin pb-4 items-stretch flex-1 min-h-0 snap-x snap-mandatory sm:snap-none"
      >
        {statuses.map((s) => (
          <KanbanColumn
            key={s.id}
            status={s}
            issues={byColumn(s.id)}
            projectKey={projectKey}
            isOver={overId === s.id}
            members={members}
            canEdit={canEdit}
            onQuickUpdate={handleQuickUpdate}
          />
        ))}
      </div>

      {/* Drag overlay — the floating card shown while dragging */}
      <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
        {activeIssue && (
          <KanbanCard
            issue={activeIssue}
            projectKey={projectKey}
            isDragOverlay
          />
        )}
      </DragOverlay>

      {isSaving && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-surface rounded-lg px-4 py-2 text-xs text-foreground flex items-center gap-2 shadow-[var(--shadow-overlay)] z-50">
          <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Saving...
        </div>
      )}
    </DndContext>
  );
}
