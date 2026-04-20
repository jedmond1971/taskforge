"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changePassword } from "./actions";

export function ChangePasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (next !== confirm) {
      setError("New passwords do not match");
      return;
    }

    startTransition(async () => {
      try {
        await changePassword(current, next);
        toast.success("Password changed successfully");
        setCurrent("");
        setNext("");
        setConfirm("");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        setError(msg);
      }
    });
  }

  const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";
  const inputClass = "bg-zinc-50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <label className={labelClass}>Current password</label>
        <Input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </div>

      <div className="space-y-1.5">
        <label className={labelClass}>New password</label>
        <Input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          autoComplete="new-password"
          minLength={8}
          className={inputClass}
        />
        <p className="text-xs text-zinc-500">Minimum 8 characters</p>
      </div>

      <div className="space-y-1.5">
        <label className={labelClass}>Confirm new password</label>
        <Input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
          className={inputClass}
        />
      </div>

      <Button
        type="submit"
        disabled={isPending}
        className="bg-indigo-600 hover:bg-indigo-500 text-white"
      >
        {isPending ? "Updating..." : "Update password"}
      </Button>
    </form>
  );
}
