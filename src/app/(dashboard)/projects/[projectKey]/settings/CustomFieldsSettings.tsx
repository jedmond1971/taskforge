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
import { EmptyState } from "@/components/ui/empty-state";
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
  TEXT: "bg-surface-active text-muted-foreground border border-border-soft",
  NUMBER: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
  DATE: "bg-purple-500/20 text-purple-400 border border-purple-500/30",
  CHECKBOX: "bg-success-soft text-success border border-success/20",
  SELECT: "bg-primary/20 text-primary border border-primary/30",
  MULTI_SELECT: "bg-warning-soft text-warning border border-warning/20",
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
  "w-full h-9 rounded-lg border border-border bg-surface-active px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed";

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
            <label className="text-sm font-medium text-foreground">
              Field name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Story points"
            />
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
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
              <label className="text-sm font-medium text-foreground">
                Options
              </label>
              <div className="space-y-2">
                {options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                      placeholder={`Option ${i + 1}`}
                    />
                    {options.length > 1 && (
                      <button
                        onClick={() => removeOption(i)}
                        className="p-1 text-muted-foreground hover:text-danger transition-colors flex-shrink-0"
                        title="Remove option"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={addOption}
                  className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
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
              <label className="text-sm font-medium text-foreground">
                Project restrictions
              </label>
              <p className="text-xs text-muted-foreground">
                Leave all unchecked to apply this field to every project in the organization.
              </p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto rounded-lg border border-border-soft p-2">
                {projects.map((project) => (
                  <label
                    key={project.id}
                    className="flex items-center gap-2.5 cursor-pointer rounded-md px-2 py-1.5 hover:bg-surface-active"
                  >
                    <input
                      type="checkbox"
                      checked={selectedProjectIds.includes(project.id)}
                      onChange={() => toggleProject(project.id)}
                      className="accent-primary"
                    />
                    <span className="text-sm text-foreground">
                      {project.name}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono ml-auto">
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
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
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
          <div key={i} className="h-14 bg-surface-active rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-foreground mb-1">
            Custom Fields
          </h3>
          <p className="text-xs text-muted-foreground">
            Define custom fields for this organization&apos;s issues. Fields can be
            restricted to specific projects or applied org-wide.
          </p>
        </div>
        <Button
          onClick={openAdd}
          size="sm"
          className="flex-shrink-0"
        >
          <Plus className="size-3.5 mr-1" />
          Add Field
        </Button>
      </div>

      {/* Field list */}
      {fields.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border">
          <EmptyState
            icon={Plus}
            title="No custom fields yet"
            message="Add a field to start tracking custom data on issues."
            className="py-12"
          />
        </div>
      ) : (
        <div className="divide-y divide-border-soft rounded-xl border border-border-soft overflow-hidden">
          {fields.map((field) => {
            const restrictions = field.projectRestrictions;
            return (
              <div
                key={field.id}
                className="flex items-start gap-3 px-4 py-3 bg-surface"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
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
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-surface-active text-muted-foreground"
                        >
                          {opt}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Restriction summary */}
                  <p className="text-xs text-muted-foreground">
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
                    className="text-muted-foreground hover:text-foreground"
                    title="Edit field"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeletingField(field)}
                    className="text-muted-foreground hover:text-danger hover:bg-danger-soft"
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
