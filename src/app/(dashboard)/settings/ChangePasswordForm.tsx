"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changePassword } from "./actions";

export function ChangePasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { update } = useSession();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (next !== confirm) {
      setError("New passwords do not match");
      return;
    }

    startTransition(async () => {
      const result = await changePassword(current, next);
      if (!result.success) {
        setError(result.error);
        return;
      }
      // Re-arm this session so it stays logged in while other sessions are
      // invalidated. The jwt callback re-syncs sessionVersion on trigger === "update".
      await update({});
      toast.success("Password changed successfully");
      setCurrent("");
      setNext("");
      setConfirm("");
    });
  }

  const labelClass = "text-sm font-medium text-foreground";

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
      {error && (
        <div className="bg-danger-soft border border-danger/20 rounded-lg p-3 text-danger text-sm">
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
        />
        <p className="text-xs text-muted-foreground">Minimum 8 characters</p>
      </div>

      <div className="space-y-1.5">
        <label className={labelClass}>Confirm new password</label>
        <Input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>

      <Button
        type="submit"
        disabled={isPending}
      >
        {isPending ? "Updating..." : "Update password"}
      </Button>
    </form>
  );
}
