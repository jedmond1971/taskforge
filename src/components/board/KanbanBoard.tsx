"use client";

import { useState, useCallback, useEffect } from "react";
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
import { IssueStatus, IssuePriority, IssueType } from "@prisma/client";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard } from "./KanbanCard";
import { moveIssue, reorderIssues } from "@/app/(dashboard)/projects/[projectKey]/actions";
import { STATUS_CATEGORY } from "@/lib/issue-utils";
import { toast } from "sonner";

// CANCELLED belongs to the Done category — it shows in the Done column, not its own column.
const BOARD_COLUMNS: IssueStatus[] = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"];

type CardIssue = {
  id: string;
  key: string;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  type: IssueType;
  position: number;
  dueDate?: Date | null;
  assignee: { id: string; name: string; avatarUrl: string | null } | null;
};

interface KanbanBoardProps {
  initialIssues: CardIssue[];
  projectKey: string;
}

// Custom collision detection: prefer column droppables for cross-column detection
const customCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

export function KanbanBoard({ initialIssues, projectKey }: KanbanBoardProps) {
  const [issues, setIssues] = useState<CardIssue[]>(initialIssues);
  const [activeIssue, setActiveIssue] = useState<CardIssue | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // Sync server-refreshed issues into local state, but not while a drag is in flight
  useEffect(() => {
    if (!activeIssue) setIssues(initialIssues);
  }, [initialIssues]); // eslint-disable-line react-hooks/exhaustive-deps

  // Group issues by board column (category), sorted by position
  const byColumn = useCallback(
    (columnId: IssueStatus) =>
      issues
        .filter((i) => STATUS_CATEGORY[i.status] === columnId)
        .sort((a, b) => a.position - b.position),
    [issues]
  );

  function handleDragStart({ active }: DragStartEvent) {
    const issue = issues.find((i) => i.id === active.id);
    setActiveIssue(issue ?? null);
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    setOverId(over?.id ? String(over.id) : null);
    if (!over || active.id === over.id) return;

    const activeIssueItem = issues.find((i) => i.id === active.id);
    if (!activeIssueItem) return;

    // Resolve target column: droppable id OR the category of the card being hovered
    const overIssueStatus = issues.find((i) => i.id === over.id)?.status;
    const overColumn: IssueStatus | undefined = BOARD_COLUMNS.includes(over.id as IssueStatus)
      ? (over.id as IssueStatus)
      : overIssueStatus != null
      ? (STATUS_CATEGORY[overIssueStatus] as IssueStatus)
      : undefined;

    if (!overColumn || overColumn === STATUS_CATEGORY[activeIssueItem.status]) return;

    // Optimistically move the card to the new column (always targets the column's primary status)
    setIssues((prev) =>
      prev.map((i) =>
        i.id === activeIssueItem.id ? { ...i, status: overColumn } : i
      )
    );
  }

  function handleDragEnd({ over }: DragEndEvent) {
    const draggedIssue = activeIssue;
    setActiveIssue(null);
    setOverId(null);

    if (!over || !draggedIssue) return;

    // Resolve destination column (always the primary/category status, never CANCELLED directly)
    const overIssueStatus = issues.find((i) => i.id === over.id)?.status;
    const destStatus: IssueStatus = BOARD_COLUMNS.includes(over.id as IssueStatus)
      ? (over.id as IssueStatus)
      : overIssueStatus != null
      ? (STATUS_CATEGORY[overIssueStatus] as IssueStatus)
      : STATUS_CATEGORY[draggedIssue.status] as IssueStatus;

    // All issues in the destination column (may include multiple statuses, e.g. DONE + CANCELLED)
    const destColumn = issues
      .filter((i) => STATUS_CATEGORY[i.status] === destStatus)
      .sort((a, b) => a.position - b.position);

    if (destStatus !== STATUS_CATEGORY[draggedIssue.status]) {
      const overIndex = destColumn.findIndex((i) => i.id === over.id);
      const newPosition = overIndex === -1 ? destColumn.length : overIndex;

      setIssues((prev) =>
        prev.map((i) =>
          i.id === draggedIssue.id
            ? { ...i, status: destStatus, position: newPosition }
            : i
        )
      );

      setIsSaving(true);
      moveIssue(projectKey, draggedIssue.id, destStatus, newPosition)
        .catch(() => {
          toast.error("Failed to move issue");
          setIssues(initialIssues);
        })
        .finally(() => {
          setIsSaving(false);
        });
    } else {
      const oldIndex = destColumn.findIndex((i) => i.id === draggedIssue.id);
      const newIndex = destColumn.findIndex((i) => i.id === over.id);

      if (oldIndex === newIndex) return;

      const reordered = arrayMove(destColumn, oldIndex, newIndex);

      setIssues((prev) => {
        const otherColumns = prev.filter((i) => STATUS_CATEGORY[i.status] !== destStatus);
        const updated = reordered.map((issue, idx) => ({ ...issue, position: idx }));
        return [...otherColumns, ...updated];
      });

      setIsSaving(true);
      reorderIssues(projectKey, reordered.map((i) => i.id))
        .catch(() => {
          toast.error("Failed to reorder issues");
          setIssues(initialIssues);
        })
        .finally(() => {
          setIsSaving(false);
        });
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
      <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-4 items-start">
        {BOARD_COLUMNS.map((columnId) => (
          <KanbanColumn
            key={columnId}
            status={columnId}
            issues={byColumn(columnId)}
            projectKey={projectKey}
            isOver={overId === columnId}
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
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 text-xs text-zinc-700 dark:text-zinc-300 flex items-center gap-2 shadow-lg z-50">
          <div className="w-3 h-3 border-2 border-indigo-500 dark:border-indigo-400 border-t-transparent rounded-full animate-spin" />
          Saving...
        </div>
      )}
    </DndContext>
  );
}
