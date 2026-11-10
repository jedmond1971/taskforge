"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { adminCreateStorageMarker } from "../actions";

const card = "bg-surface shadow-[var(--shadow-panel)] rounded-xl p-6";

export function StorageMarkerClient({
  state,
  message,
}: {
  state: "ok" | "not_set_up" | "problem" | "unreadable";
  message: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function create() {
    startTransition(async () => {
      try {
        const res = await adminCreateStorageMarker();
        if (!res.success) {
          toast.error(res.error);
          return;
        }
        toast.success("Storage marker created");
        router.refresh();
      } catch {
        toast.error("Something went wrong");
      }
    });
  }

  const ok = state === "ok";
  return (
    <div className="space-y-6 max-w-3xl">
      <div className={card}>
        <h2 className="text-lg font-semibold text-foreground mb-3">Attachment storage marker</h2>
        <p className="flex items-start gap-2 text-sm mb-4">
          <span className={ok ? "text-success" : "text-danger"}>{ok ? "✓" : "✗"}</span>
          <span className="text-foreground">{message}</span>
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          The nightly cleanup deletes attachment files that have no record in this database. Before it deletes anything
          it checks that the same marker is stored in the bucket and in this database, so an app pointed at the wrong
          database can never treat every customer file as an orphan. Create the marker once, from production.
        </p>
        {state === "not_set_up" && (
          <Button onClick={create} disabled={pending}>
            {pending ? "Creating…" : "Create storage marker"}
          </Button>
        )}
      </div>
    </div>
  );
}
