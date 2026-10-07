"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { CheckCircle2, Circle, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { OnboardingState } from "@/lib/onboarding";

// Dismissal is a per-browser convenience (no schema for user preferences), keyed by user so a
// shared machine doesn't hide it for the next person.
const storageKey = (userId: string) => `jedforge:onboarding-dismissed:${userId}`;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function readDismissed(userId: string) {
  try {
    return window.localStorage.getItem(storageKey(userId)) === "1";
  } catch {
    return false;
  }
}

function dismiss(userId: string) {
  try {
    window.localStorage.setItem(storageKey(userId), "1");
  } catch {
    // Storage blocked: nothing to persist; the card simply returns on next load.
  }
  listeners.forEach((l) => l());
}

export function OnboardingChecklist({
  state,
  userId,
}: {
  state: Exclude<OnboardingState, { kind: "hidden" }>;
  userId: string;
}) {
  // Server snapshot says "dismissed" so the card never flashes in for someone who already closed it.
  const dismissed = useSyncExternalStore(
    subscribe,
    () => readDismissed(userId),
    () => true
  );
  if (dismissed) return null;

  const dismissButton = (
    <button
      type="button"
      onClick={() => dismiss(userId)}
      aria-label="Dismiss getting started"
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-active transition-colors"
    >
      <X className="w-4 h-4" />
    </button>
  );

  if (state.kind === "ask-admin") {
    return (
      <Card className="bg-surface shadow-[var(--shadow-panel)]">
        <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base font-semibold text-foreground">Getting started</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">
              You&apos;re not on any projects yet. Ask an admin of your organization to add you to one.
            </p>
          </div>
          {dismissButton}
        </div>
        </CardHeader>
      </Card>
    );
  }

  const done = state.steps.filter((s) => s.done).length;

  return (
    <Card className="bg-surface shadow-[var(--shadow-panel)]" aria-label="Getting started checklist">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base font-semibold text-foreground">Getting started</CardTitle>
          <p className="text-sm text-muted-foreground mt-0.5">
            {done} of {state.steps.length} done
          </p>
        </div>
        {dismissButton}
        </div>
      </CardHeader>
      <CardContent>
        <ol className="space-y-1">
          {state.steps.map((step) => {
            const body = (
              <>
                {step.done ? (
                  <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" aria-hidden="true" />
                ) : (
                  <Circle className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" aria-hidden="true" />
                )}
                <span className="min-w-0">
                  <span className={cn("block text-sm font-medium text-foreground", step.done && "line-through text-muted-foreground")}>
                    {step.label}
                    {step.done && <span className="sr-only"> (done)</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {step.href || step.done ? step.description : "Available once you have a project."}
                  </span>
                </span>
              </>
            );
            return (
              <li key={step.id}>
                {step.href && !step.done ? (
                  <Link href={step.href} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-active transition-colors">
                    {body}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 px-2 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
