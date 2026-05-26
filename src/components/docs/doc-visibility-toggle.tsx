"use client";

import { useState } from "react";
import { Globe, Lock } from "lucide-react";

interface DocVisibilityToggleProps {
  projectKey: string;
  initialIsPublic: boolean;
}

export function DocVisibilityToggle({ projectKey, initialIsPublic }: DocVisibilityToggleProps) {
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle() {
    const next = !isPublic;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/docs/${projectKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: next }),
      });
      if (!res.ok) throw new Error("Failed to update visibility");
      setIsPublic(next);
    } catch {
      setError("Could not update visibility");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleToggle}
        disabled={saving}
        title={isPublic ? "Public — all JedForge users can view" : "Private — project members only"}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors disabled:opacity-50 ${
          isPublic
            ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900"
            : "border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
        }`}
      >
        {isPublic ? (
          <Globe className="w-3.5 h-3.5" />
        ) : (
          <Lock className="w-3.5 h-3.5" />
        )}
        <span className="hidden sm:inline">{isPublic ? "Public" : "Private"}</span>
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
