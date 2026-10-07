"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { StatusCategory, IssuePriority, IssueType } from "@prisma/client";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard } from "./KanbanCard";
import { moveIssue, reorderIssues } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { toast } from "sonner";
import { boardSignature, setBoardBusy } from "@/lib/board-activity";

type BoardStatus = {
  id: string;
  name: string;
  category: StatusCategory;
  position: number;
};

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

export function KanbanBoard({ initialIssues, statuses, projectKey, sprintScopeId }: KanbanBoardProps) {
  const [issues, setIssues] = useState<CardIssue[]>(initialIssues);
  const [activeIssue, setActiveIssue] = useState<CardIssue | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Where the dragged card started, so a completed cross-column move can be undone.
  const dragOrigin = useRef<{ statusId: string; index: number } | null>(null);

  const statusIds = new Set(statuses.map((s) => s.id));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // AutoRefresh holds off while a card is being dragged or a move is still saving.
  useEffect(() => {
    setBoardBusy(activeIssue !== null || isSaving);
  }, [activeIssue, isSaving]);
  useEffect(() => () => setBoardBusy(false), []);

  // Fingerprint of the last server data we synced, and when this user last wrote — together they
  // tell a change from someone else (worth a "Board updated" pill) from the echo of our own move.
  const syncedSignature = useRef(boardSignature(initialIssues));
  const lastLocalWrite = useRef(0);

  // Sync server-refreshed issues into local state, but not while a drag is in flight
  useEffect(() => {
    if (activeIssue) return;
    setIssues(initialIssues);
    const signature = boardSignature(initialIssues);
    if (signature === syncedSignature.current) return;
    syncedSignature.current = signature;
    if (Date.now() - lastLocalWrite.current > OWN_WRITE_ECHO_MS) {
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
    lastLocalWrite.current = Date.now();
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
        lastLocalWrite.current = Date.now();
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
    lastLocalWrite.current = Date.now();
    reorderIssues(projectKey, orderedIds, sprintScopeId)
      .catch(() => {
        setIssues(initialIssues);
        toast.error("Failed to reorder issues", {
          action: { label: "Retry", onClick: () => saveReorder(orderedIds, destStatusId) },
        });
      })
      .finally(() => {
        lastLocalWrite.current = Date.now();
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
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 sm:gap-4 overflow-x-auto scrollbar-thin pb-4 items-stretch flex-1 min-h-0">
        {statuses.map((s) => (
          <KanbanColumn
            key={s.id}
            status={s}
            issues={byColumn(s.id)}
            projectKey={projectKey}
            isOver={overId === s.id}
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
