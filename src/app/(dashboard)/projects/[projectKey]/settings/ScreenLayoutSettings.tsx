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
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getProjectFieldLayout, reorderProjectFieldLayout } from "./custom-field-layout-actions";

type LayoutField = {
  id: string;
  name: string;
  type: CustomFieldType;
};

const TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  CHECKBOX: "Checkbox",
  SELECT: "Select",
  MULTI_SELECT: "Multi-select",
};

function FieldRow({ field }: { field: LayoutField }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 cursor-grab active:cursor-grabbing touch-none"
        tabIndex={-1}
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300 truncate">
        {field.name}
      </span>
      <span className="text-xs text-zinc-400 dark:text-zinc-600">
        {TYPE_LABELS[field.type]}
      </span>
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = fields.findIndex((f) => f.id === active.id);
    const newIndex = fields.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(fields, oldIndex, newIndex);

    setFields(reordered);

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
          <div key={i} className="h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          Custom field order
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Drag to arrange the order custom fields appear on this project&apos;s issue
          screen. Field definitions themselves are managed org-wide in the Custom
          Fields tab.
        </p>
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500 px-3 py-6 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg">
          No custom fields apply to this project yet.
        </p>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {fields.map((f) => (
                <FieldRow key={f.id} field={f} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
