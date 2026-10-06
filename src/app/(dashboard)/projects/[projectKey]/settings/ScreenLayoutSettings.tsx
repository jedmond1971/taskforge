"use client";

import { useEffect, useState } from "react";
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
import { CustomFieldType } from "@prisma/client";
import { GripVertical, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getProjectFieldLayout,
  reorderProjectFieldLayout,
  setProjectFieldHidden,
} from "./custom-field-layout-actions";

type LayoutField = {
  id: string;
  name: string;
  type: CustomFieldType;
  hidden: boolean;
};

const TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  CHECKBOX: "Checkbox",
  SELECT: "Select",
  MULTI_SELECT: "Multi-select",
};

function FieldRow({ field, onRemove }: { field: LayoutField; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg border border-border-soft bg-surface",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none"
        tabIndex={-1}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="flex-1 text-sm text-foreground truncate">
        {field.name}
      </span>
      <span className="text-xs text-muted-foreground">
        {TYPE_LABELS[field.type]}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground"
        title="Remove from this screen"
        aria-label={`Remove ${field.name} from this screen`}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ScreenLayoutSettings({ projectKey }: { projectKey: string }) {
  const [fields, setFields] = useState<LayoutField[]>([]);
  const [loading, setLoading] = useState(true);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  useEffect(() => {
    getProjectFieldLayout(projectKey)
      .then(setFields)
      .catch(() => toast.error("Failed to load screen layout"))
      .finally(() => setLoading(false));
  }, [projectKey]);

  const visible = fields.filter((f) => !f.hidden);
  const removed = fields.filter((f) => f.hidden);

  function toggleHidden(field: LayoutField, hidden: boolean) {
    setFields((prev) => prev.map((f) => (f.id === field.id ? { ...f, hidden } : f)));
    setProjectFieldHidden(projectKey, field.id, hidden)
      .then(() => {
        // Re-added fields go to the end of the arranged list; reload to match.
        if (!hidden) getProjectFieldLayout(projectKey).then(setFields);
      })
      .catch(() => {
        toast.error(hidden ? "Failed to remove field" : "Failed to add field back");
        getProjectFieldLayout(projectKey).then(setFields);
      });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = visible.findIndex((f) => f.id === active.id);
    const newIndex = visible.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(visible, oldIndex, newIndex);

    setFields([...reordered, ...removed]);

    reorderProjectFieldLayout(
      projectKey,
      reordered.map((f, i) => ({ customFieldId: f.id, position: i }))
    ).catch(() => {
      toast.error("Failed to reorder");
      getProjectFieldLayout(projectKey).then(setFields);
    });
  }

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-surface-active rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-foreground mb-1">
          Custom field order
        </h3>
        <p className="text-xs text-muted-foreground">
          Drag to arrange the order custom fields appear on this project&apos;s issue
          screen, or remove one from this screen. Removing a field only hides it
          here — it stays available to other projects and keeps its values. Field
          definitions themselves are managed org-wide in the Custom Fields tab.
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground px-3 py-6 text-center border border-dashed border-border-soft rounded-lg">
          {removed.length > 0
            ? "All custom fields have been removed from this screen."
            : "No custom fields apply to this project yet."}
        </p>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={visible.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {visible.map((f) => (
                <FieldRow key={f.id} field={f} onRemove={() => toggleHidden(f, true)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {removed.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium text-muted-foreground">
            Removed from this screen
          </h4>
          {removed.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border-soft"
            >
              <span className="flex-1 text-sm text-muted-foreground truncate">{f.name}</span>
              <span className="text-xs text-muted-foreground">{TYPE_LABELS[f.type]}</span>
              <button
                type="button"
                onClick={() => toggleHidden(f, false)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                aria-label={`Add ${f.name} back to this screen`}
              >
                <Plus className="w-3.5 h-3.5" />
                Add back
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
