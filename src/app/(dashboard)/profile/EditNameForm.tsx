"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateOwnProfile } from "../settings/actions";

export function EditNameForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { update } = useSession();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateOwnProfile({ name });
      if (!result.success) {
        setError(result.error);
        return;
      }
      // Re-reads the name from the DB into the JWT so the header and sidebar update.
      await update({});
      router.refresh();
      setSaved(name.trim());
      toast.success("Name updated");
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 max-w-sm">
      <label htmlFor="profile-name" className="text-sm font-medium text-foreground">
        Display name
      </label>
      <div className="flex gap-2">
        <Input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
          autoComplete="name"
        />
        <Button type="submit" disabled={isPending || name.trim() === saved}>
          {isPending ? "Saving..." : "Save"}
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
  );
}
