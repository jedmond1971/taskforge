"use client";

import { useState, useTransition } from "react";
import { CustomFieldType } from "@prisma/client";
import { toast } from "sonner";
import { setCustomFieldValue } from "@/app/(dashboard)/projects/[projectKey]/issues/[issueKey]/custom-field-value-actions";

type CustomField = {
  id: string;
  name: string;
  type: CustomFieldType;
  options: string[];
  position: number;
};

interface CustomFieldsPanelProps {
  issueId: string;
  projectKey: string;
  fields: CustomField[];
  initialValues: Record<string, string | number | boolean | string[]>;
  canEdit: boolean;
  onSaved: () => void;
}

function initDisplayValues(
  fields: CustomField[],
  initialValues: Record<string, string | number | boolean | string[]>
): Record<string, string | boolean | string[]> {
  const result: Record<string, string | boolean | string[]> = {};
  for (const field of fields) {
    const v = initialValues[field.id];
    if (field.type === "CHECKBOX") {
      result[field.id] = v === true;
    } else if (field.type === "MULTI_SELECT") {
      result[field.id] = Array.isArray(v) ? v : [];
    } else if (field.type === "DATE" && typeof v === "string") {
      result[field.id] = v.split("T")[0];
    } else {
      result[field.id] = v != null ? String(v) : "";
    }
  }
  return result;
}

const inputClass =
  "w-full px-2 py-1.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50";

export function CustomFieldsPanel({
  issueId,
  projectKey,
  fields,
  initialValues,
  canEdit,
  onSaved,
}: CustomFieldsPanelProps) {
  const [values, setValues] = useState<Record<string, string | boolean | string[]>>(
    () => initDisplayValues(fields, initialValues)
  );
  const [isPending, startTransition] = useTransition();

  function save(fieldId: string, newValue: string | number | boolean | string[] | null) {
    startTransition(async () => {
      try {
        await setCustomFieldValue(projectKey, issueId, fieldId, newValue);
        toast.success("Field updated");
        onSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to update field");
      }
    });
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => {
        switch (field.type) {
          case "TEXT":
            return (
              <div key={field.id}>
                <p className="text-xs text-zinc-500 font-medium mb-1">{field.name}</p>
                <input
                  type="text"
                  value={(values[field.id] as string) ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                  }
                  onBlur={(e) => save(field.id, e.target.value.trim() || null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.repeat) e.currentTarget.blur();
                  }}
                  disabled={isPending || !canEdit}
                  className={inputClass}
                />
              </div>
            );

          case "NUMBER":
            return (
              <div key={field.id}>
                <p className="text-xs text-zinc-500 font-medium mb-1">{field.name}</p>
                <input
                  type="number"
                  value={(values[field.id] as string) ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                  }
                  onBlur={(e) => {
                    const raw = e.target.value;
                    if (raw === "") {
                      save(field.id, null);
                    } else {
                      const num = Number(raw);
                      if (isFinite(num)) save(field.id, num);
                    }
                  }}
                  disabled={isPending || !canEdit}
                  className={inputClass}
                />
              </div>
            );

          case "DATE":
            return (
              <div key={field.id}>
                <p className="text-xs text-zinc-500 font-medium mb-1">{field.name}</p>
                <input
                  type="date"
                  value={(values[field.id] as string) ?? ""}
                  onChange={(e) => {
                    const dateStr = e.target.value;
                    setValues((prev) => ({ ...prev, [field.id]: dateStr }));
                    save(field.id, dateStr || null);
                  }}
                  disabled={isPending || !canEdit}
                  className={inputClass}
                />
              </div>
            );

          case "CHECKBOX":
            return (
              <div key={field.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`cf-${field.id}`}
                  checked={(values[field.id] as boolean) ?? false}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setValues((prev) => ({ ...prev, [field.id]: checked }));
                    save(field.id, checked);
                  }}
                  disabled={isPending || !canEdit}
                  className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                />
                <label
                  htmlFor={`cf-${field.id}`}
                  className="text-xs text-zinc-500 font-medium"
                >
                  {field.name}
                </label>
              </div>
            );

          case "SELECT":
            return (
              <div key={field.id}>
                <p className="text-xs text-zinc-500 font-medium mb-1">{field.name}</p>
                <select
                  value={(values[field.id] as string) ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setValues((prev) => ({ ...prev, [field.id]: v }));
                    save(field.id, v || null);
                  }}
                  disabled={isPending || !canEdit}
                  className={inputClass + " min-h-[44px]"}
                >
                  <option value="">—</option>
                  {field.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            );

          case "MULTI_SELECT": {
            const selected = (values[field.id] as string[]) ?? [];
            return (
              <div key={field.id}>
                <p className="text-xs text-zinc-500 font-medium mb-1">{field.name}</p>
                <div className="space-y-1">
                  {field.options.map((opt) => {
                    const checked = selected.includes(opt);
                    return (
                      <label
                        key={opt}
                        className="flex items-center gap-2 cursor-pointer group"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? selected.filter((v) => v !== opt)
                              : [...selected, opt];
                            setValues((prev) => ({ ...prev, [field.id]: next }));
                            save(field.id, next.length > 0 ? next : null);
                          }}
                          disabled={isPending || !canEdit}
                          className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                        />
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">{opt}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          }

          default:
            return null;
        }
      })}
    </div>
  );
}
