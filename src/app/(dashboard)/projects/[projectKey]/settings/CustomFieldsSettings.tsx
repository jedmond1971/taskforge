"use client";

import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { CustomFieldType } from "@prisma/client";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  getCustomFields,
  getOrgProjects,
  createCustomField,
  updateCustomField,
  deleteCustomField,
} from "./custom-field-actions";

// ─── Types ────────────────────────────────────────────────────────────────────

type OrgProject = { id: string; name: string; key: string };

type FieldRestriction = {
  id: string;
  customFieldId: string;
  projectId: string;
  project: OrgProject;
};

type CustomField = {
  id: string;
  orgId: string;
  name: string;
  type: CustomFieldType;
  options: string[];
  position: number;
  projectRestrictions: FieldRestriction[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  CHECKBOX: "Checkbox",
  SELECT: "Select",
  MULTI_SELECT: "Multi-select",
};

const TYPE_BADGE: Record<CustomFieldType, string> = {
  TEXT: "bg-zinc-500/20 text-zinc-400 border border-zinc-500/30",
  NUMBER: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
  DATE: "bg-purple-500/20 text-purple-400 border border-purple-500/30",
  CHECKBOX: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
  SELECT: "bg-indigo-500/20 text-indigo-400 border border-indigo-500/30",
  MULTI_SELECT: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
};

const ALL_TYPES: CustomFieldType[] = [
  "TEXT",
  "NUMBER",
  "DATE",
  "CHECKBOX",
  "SELECT",
  "MULTI_SELECT",
];

const selectStyles =
  "w-full h-9 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed";

// ─── Field Dialog ─────────────────────────────────────────────────────────────

function FieldDialog({
  open,
  onOpenChange,
  field,
  projects,
  orgId,
  projectKey,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: CustomField | null;
  projects: OrgProject[];
  orgId: string;
  projectKey: string;
  onSaved: () => void;
}) {
  const isEdit = field !== null;

  const [name, setName] = useState("");
  const [type, setType] = useState<CustomFieldType>("TEXT");
  const [options, setOptions] = useState<string[]>([""]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Populate form when dialog opens or field changes
  useEffect(() => {
    if (open) {
      if (field) {
        setName(field.name);
        setType(field.type);
        setOptions(field.options.length > 0 ? field.options : [""]);
        setSelectedProjectIds(field.projectRestrictions.map((r) => r.projectId));
      } else {
        setName("");
        setType("TEXT");
        setOptions([""]);
        setSelectedProjectIds([]);
      }
    }
  }, [open, field]);

  const isSelectType = type === "SELECT" || type === "MULTI_SELECT";

  function addOption() {
    setOptions((prev) => [...prev, ""]);
  }

  function removeOption(index: number) {
    setOptions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateOption(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  function toggleProject(id: string) {
    setSelectedProjectIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function handleSubmit() {
    setSaving(true);
    try {
      if (isEdit) {
        const result = await updateCustomField(
          orgId,
          field.id,
          {
            name,
            ...(isSelectType ? { options } : {}),
            restrictedProjectIds: selectedProjectIds,
          },
          projectKey
        );
        if (!result.success) throw new Error("Update failed");
        toast.success("Custom field updated");
      } else {
        const result = await createCustomField(
          orgId,
          { name, type, options: isSelectType ? options : [], restrictedProjectIds: selectedProjectIds },
          projectKey
        );
        if (!result.success) throw new Error("Create failed");
        toast.success("Custom field created");
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save field");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Custom Field" : "Add Custom Field"}</DialogTitle>
          {isEdit && (
            <DialogDescription>
              Field type cannot be changed after creation. To use a different type, delete this field and create a new one.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Field name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Story points"
              className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
            />
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Field type
            </label>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as CustomFieldType);
                setOptions([""]);
              }}
              disabled={isEdit}
              className={selectStyles}
            >
              {ALL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {/* Options (SELECT / MULTI_SELECT only) */}
          {isSelectType && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Options
              </label>
              <div className="space-y-2">
                {options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                      className="bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                    />
                    {options.length > 1 && (
                      <button
                        onClick={() => removeOption(i)}
                        className="p-1 text-zinc-400 hover:text-red-400 transition-colors flex-shrink-0"
                        title="Remove option"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={addOption}
                  className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  <Plus className="size-3.5" />
                  Add option
                </button>
              </div>
            </div>
          )}

          {/* Project restrictions */}
          {projects.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Project restrictions
              </label>
              <p className="text-xs text-zinc-500 dark:text-zinc-500">
                Leave all unchecked to apply this field to every project in the organization.
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
                {projects.map((project) => (
                  <label
                    key={project.id}
                    className="flex items-center gap-2.5 cursor-pointer rounded-md px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <input
                      type="checkbox"
                      checked={selectedProjectIds.includes(project.id)}
                      onChange={() => toggleProject(project.id)}
                      className="accent-indigo-500"
                    />
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">
                      {project.name}
                    </span>
                    <span className="text-xs text-zinc-500 font-mono ml-auto">
                      {project.key}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Field"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CustomFieldsSettings({
  orgId,
  projectKey,
}: {
  orgId: string;
  projectKey: string;
}) {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [projects, setProjects] = useState<OrgProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomField | null>(null);
  const [deletingField, setDeletingField] = useState<CustomField | null>(null);
  const [deleting, setDeleting] = useState(false);
  const hasFetched = useRef(false);

  async function loadData() {
    try {
      const [fetchedFields, fetchedProjects] = await Promise.all([
        getCustomFields(orgId),
        getOrgProjects(orgId),
      ]);
      setFields(fetchedFields);
      setProjects(fetchedProjects);
    } catch {
      toast.error("Failed to load custom fields");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!hasFetched.current) {
      hasFetched.current = true;
      loadData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openAdd() {
    setEditingField(null);
    setDialogOpen(true);
  }

  function openEdit(field: CustomField) {
    setEditingField(field);
    setDialogOpen(true);
  }

  async function handleDelete() {
    if (!deletingField) return;
    setDeleting(true);
    try {
      await deleteCustomField(orgId, deletingField.id, projectKey);
      toast.success("Custom field deleted");
      setDeletingField(null);
      loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete field");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            Custom Fields
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            Define custom fields for this organization&apos;s issues. Fields can be
            restricted to specific projects or applied org-wide.
          </p>
        </div>
        <Button
          onClick={openAdd}
          size="sm"
          className="bg-indigo-600 hover:bg-indigo-500 text-white flex-shrink-0"
        >
          <Plus className="size-3.5 mr-1" />
          Add Field
        </Button>
      </div>

      {/* Field list */}
      {fields.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No custom fields yet
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-1">
            Add a field to start tracking custom data on issues.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          {fields.map((field) => {
            const restrictions = field.projectRestrictions;
            return (
              <div
                key={field.id}
                className="flex items-start gap-3 px-4 py-3 bg-white dark:bg-zinc-900"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {field.name}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium",
                        TYPE_BADGE[field.type]
                      )}
                    >
                      {TYPE_LABELS[field.type]}
                    </span>
                  </div>

                  {/* Options chips */}
                  {field.options.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {field.options.map((opt) => (
                        <span
                          key={opt}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                        >
                          {opt}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Restriction summary */}
                  <p className="text-xs text-zinc-500 dark:text-zinc-500">
                    {restrictions.length === 0
                      ? "All projects"
                      : restrictions.map((r) => r.project.name).join(", ")}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openEdit(field)}
                    className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    title="Edit field"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeletingField(field)}
                    className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                    title="Delete field"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit dialog */}
      <FieldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        field={editingField}
        projects={projects}
        orgId={orgId}
        projectKey={projectKey}
        onSaved={loadData}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deletingField}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeletingField(null);
        }}
        title={`Delete "${deletingField?.name}"?`}
        description="This permanently deletes the field and removes its value from every issue in your organization. This action cannot be undone."
        confirmLabel={deleting ? "Deleting..." : "Delete"}
        onConfirm={handleDelete}
      />
    </div>
  );
}
