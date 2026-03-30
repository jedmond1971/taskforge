"use client";

import { useState, useCallback } from "react";
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
import { toast } from "sonner";

const STATUSES: IssueStatus[] = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"];

type CardIssue = {
  id: string;
  key: string;
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  type: IssueType;
  position: number;
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

  // Group issues by status, sorted by position
  const byStatus = useCallback(
    (status: IssueStatus) =>
      issues
        .filter((i) => i.status === status)
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

    // Determine the target status — over could be a column droppable id or another card's id
    const overStatus = STATUSES.includes(over.id as IssueStatus)
      ? (over.id as IssueStatus)
      : issues.find((i) => i.id === over.id)?.status;

    if (!overStatus || overStatus === activeIssueItem.status) return;

    // Optimistically move the card to the new column
    setIssues((prev) =>
      prev.map((i) =>
        i.id === activeIssueItem.id ? { ...i, status: overStatus } : i
      )
    );
  }

  function handleDragEnd({ over }: DragEndEvent) {
    // Capture original issue before clearing — handleDragOver has already mutated
    // `issues` state (optimistic update), so reading from `issues` here would give
    // the post-move status, not the original. activeIssue was set at dragStart.
    const draggedIssue = activeIssue;
    setActiveIssue(null);
    setOverId(null);

    if (!over || !draggedIssue) return;

    // Determine destination status from the drop target id
    const destStatus: IssueStatus = STATUSES.includes(over.id as IssueStatus)
      ? (over.id as IssueStatus)
      : (issues.find((i) => i.id === over.id)?.status ?? draggedIssue.status);

    const destColumn = issues
      .filter((i) => i.status === destStatus)
      .sort((a, b) => a.position - b.position);

    if (destStatus !== draggedIssue.status) {
      // Cross-column move — draggedIssue.status is the ORIGINAL column
      const overIndex = destColumn.findIndex((i) => i.id === over.id);
      const newPosition = overIndex === -1 ? destColumn.length : overIndex;

      // Finalize optimistic update with correct position
      setIssues((prev) =>
        prev.map((i) =>
          i.id === draggedIssue.id
            ? { ...i, status: destStatus, position: newPosition }
            : i
        )
      );

      // Persist
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
      // Within same column — reorder
      const oldIndex = destColumn.findIndex((i) => i.id === draggedIssue.id);
      const newIndex = destColumn.findIndex((i) => i.id === over.id);

      if (oldIndex === newIndex) return;

      const reordered = arrayMove(destColumn, oldIndex, newIndex);

      // Optimistic update
      setIssues((prev) => {
        const otherColumns = prev.filter((i) => i.status !== destStatus);
        const updated = reordered.map((issue, idx) => ({ ...issue, position: idx }));
        return [...otherColumns, ...updated];
      });

      // Persist
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
      <div className="flex gap-4 overflow-x-auto pb-4 items-start min-w-max">
        {STATUSES.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            issues={byStatus(status)}
            projectKey={projectKey}
            isOver={overId === status}
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
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-xs text-zinc-300 flex items-center gap-2 shadow-lg z-50">
          <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
          Saving...
        </div>
      )}
    </DndContext>
  );
}
