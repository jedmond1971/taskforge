"use client";

import { useEffect, useState, useTransition, useRef } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { StatusCategory } from "@prisma/client";
import { GripVertical, Trash2, Plus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CATEGORY_COLOR } from "@/lib/issue-utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  getProjectStatuses,
  createProjectStatus,
  renameProjectStatus,
  deleteProjectStatus,
  reorderProjectStatuses,
} from "./board-actions";

type ProjectStatus = {
  id: string;
  name: string;
  category: StatusCategory;
  position: number;
  isDefault: boolean;
};

const CATEGORY_LABELS: Record<StatusCategory, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
};

const CATEGORIES: StatusCategory[] = ["TODO", "IN_PROGRESS", "DONE"];

// --- Sortable status row ---

function StatusRow({
  status,
  isLast,
  projectKey,
  onDelete,
  onRename,
}: {
  status: ProjectStatus;
  isLast: boolean;
  projectKey: string;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(status.name);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: status.id });

  const style = { transform: CSS.Transform.toString(transform), transition };
  const cfg = CATEGORY_COLOR[status.category];

  function startEdit() {
    setEditValue(status.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancelEdit() {
    setEditValue(status.name);
    setEditing(false);
  }

  function saveEdit() {
    if (!editValue.trim() || editValue.trim() === status.name) {
      cancelEdit();
      return;
    }
    startTransition(async () => {
      try {
        await renameProjectStatus(projectKey, status.id, editValue.trim());
        onRename(status.id, editValue.trim());
        setEditing(false);
        toast.success("Status renamed");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to rename");
      }
    });
  }

  function handleConfirmDelete() {
    startTransition(async () => {
      try {
        await deleteProjectStatus(projectKey, status.id);
        onDelete(status.id);
        toast.success("Status deleted");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete");
      }
    });
  }

  return (
    <>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete "${status.name}"?`}
        description={
          isLast
            ? "Cannot delete — this is the last status in its category."
            : `All issues in "${status.name}" will be moved to the default status of the ${CATEGORY_LABELS[status.category]} category.`
        }
        confirmLabel="Delete"
        onConfirm={isLast ? () => {} : handleConfirmDelete}
      />
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900",
          isDragging && "opacity-50 shadow-lg"
        )}
      >
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 cursor-grab active:cursor-grabbing touch-none"
          tabIndex={-1}
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Color dot */}
        <div className={cn("w-2 h-2 rounded-full flex-shrink-0", cfg.dot)} />

        {/* Name (inline edit on click) */}
        {editing ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") cancelEdit();
              }}
              className="flex-1 min-w-0 text-sm bg-zinc-50 dark:bg-zinc-800 border border-indigo-500 rounded px-2 py-1 text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
            <button
              onClick={saveEdit}
              disabled={isPending}
              className="p-1 text-emerald-600 dark:text-emerald-400 hover:text-emerald-500"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={cancelEdit}
              className="p-1 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={startEdit}
            className="flex-1 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 truncate py-0.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-800 px-1"
            title="Click to rename"
          >
            {status.name}
            {status.isDefault && (
              <span className="ml-1.5 text-xs text-zinc-400 dark:text-zinc-600">(default)</span>
            )}
          </button>
        )}

        {/* Delete button */}
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={isLast || isPending}
          className={cn(
            "p-1 rounded transition-colors",
            isLast
              ? "text-zinc-300 dark:text-zinc-700 cursor-not-allowed"
              : "text-zinc-400 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          )}
          title={isLast ? "Can't delete the last status in a category" : "Delete status"}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </>
  );
}

// --- Add status inline form ---

function AddStatusRow({
  category,
  projectKey,
  onAdd,
  onCancel,
}: {
  category: StatusCategory;
  projectKey: string;
  onAdd: (status: ProjectStatus) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSave() {
    if (!name.trim()) return;
    startTransition(async () => {
      try {
        const { status } = await createProjectStatus(projectKey, {
          name: name.trim(),
          category,
        });
        onAdd(status);
        toast.success("Status created");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create");
      }
    });
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-indigo-500/50 bg-indigo-50/30 dark:bg-indigo-900/10">
      <div className="w-4 h-4 flex-shrink-0" />
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Status name…"
        className="flex-1 min-w-0 text-sm bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
      />
      <button
        onClick={handleSave}
        disabled={isPending || !name.trim()}
        className="p-1 text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 disabled:opacity-40"
      >
        <Check className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onCancel}
        className="p-1 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// --- Main BoardSettings component ---

export function BoardSettings({ projectKey }: { projectKey: string }) {
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingCategory, setAddingCategory] = useState<StatusCategory | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  useEffect(() => {
    getProjectStatuses(projectKey)
      .then(setStatuses)
      .catch(() => toast.error("Failed to load statuses"))
      .finally(() => setLoading(false));
  }, [projectKey]);

  function byCategory(cat: StatusCategory) {
    return statuses
      .filter((s) => s.category === cat)
      .sort((a, b) => a.position - b.position);
  }

  function handleDelete(id: string) {
    setStatuses((prev) => prev.filter((s) => s.id !== id));
  }

  function handleRename(id: string, newName: string) {
    setStatuses((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: newName } : s))
    );
  }

  function handleAdd(status: ProjectStatus) {
    setStatuses((prev) => [...prev, status]);
    setAddingCategory(null);
  }

  function handleDragEnd(event: DragEndEvent, category: StatusCategory) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const catStatuses = byCategory(category);
    const oldIndex = catStatuses.findIndex((s) => s.id === active.id);
    const newIndex = catStatuses.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(catStatuses, oldIndex, newIndex);
    const updates = reordered.map((s, i) => ({ id: s.id, position: i }));

    // Optimistic update
    setStatuses((prev) => {
      const others = prev.filter((s) => s.category !== category);
      return [...others, ...reordered.map((s, i) => ({ ...s, position: i }))];
    });

    reorderProjectStatuses(projectKey, updates).catch(() => {
      toast.error("Failed to reorder");
      // Revert by refetching
      getProjectStatuses(projectKey).then(setStatuses);
    });
  }

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Board Columns</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Customize the columns on your Kanban board. Each status becomes a column.
          Drag to reorder within a category.
        </p>
      </div>

      {CATEGORIES.map((category) => {
        const catStatuses = byCategory(category);
        const cfg = CATEGORY_COLOR[category];
        const categoryIds = catStatuses.map((s) => s.id);

        return (
          <div key={category} className="space-y-2">
            {/* Category header */}
            <div className="flex items-center gap-2">
              <div className={cn("w-2 h-2 rounded-full", cfg.dot)} />
              <span className={cn("text-xs font-semibold uppercase tracking-wide", cfg.color)}>
                {CATEGORY_LABELS[category]}
              </span>
              <span className="text-xs text-zinc-400 dark:text-zinc-600">
                {catStatuses.length} {catStatuses.length === 1 ? "status" : "statuses"}
              </span>
            </div>

            {/* Sortable status list for this category */}
            <DndContext
              sensors={sensors}
              onDragEnd={(e) => handleDragEnd(e, category)}
            >
              <SortableContext items={categoryIds} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {catStatuses.map((s) => (
                    <StatusRow
                      key={s.id}
                      status={s}
                      isLast={catStatuses.length === 1}
                      projectKey={projectKey}
                      onDelete={handleDelete}
                      onRename={handleRename}
                    />
                  ))}

                  {addingCategory === category && (
                    <AddStatusRow
                      category={category}
                      projectKey={projectKey}
                      onAdd={handleAdd}
                      onCancel={() => setAddingCategory(null)}
                    />
                  )}
                </div>
              </SortableContext>
            </DndContext>

            {/* Add status button */}
            {addingCategory !== category && (
              <button
                onClick={() => setAddingCategory(category)}
                className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors px-3 py-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Add status
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
