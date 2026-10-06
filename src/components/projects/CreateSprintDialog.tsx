"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSprint } from "@/app/(dashboard)/projects/[projectKey]/sprint-actions";
import {
  SPRINT_DURATIONS,
  SprintDurationKey,
  formatDateOnly,
  isWeekend,
  parseDateOnly,
  sprintEndDate,
} from "@/lib/sprint-dates";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface CreateSprintDialogProps {
  projectKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateSprintDialog({ projectKey, open, onOpenChange }: CreateSprintDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [duration, setDuration] = useState<SprintDurationKey>("2w");
  const [startDate, setStartDate] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  // Derived, not stored: a preset's end date always follows its start date.
  const start = parseDateOnly(startDate);
  const startsOnWeekend = !!start && isWeekend(start);
  const presetEnd =
    duration !== "custom" && start && !startsOnWeekend
      ? formatDateOnly(sprintEndDate(start, SPRINT_DURATIONS[duration].businessDays))
      : "";
  const endDate = duration === "custom" ? customEnd : presetEnd;

  function reset() {
    setName("");
    setGoal("");
    setDuration("2w");
    setStartDate("");
    setCustomEnd("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Sprint name cannot be empty");
    if (!start) return toast.error("Choose a start date");
    if (startsOnWeekend && duration !== "custom") return toast.error("A sprint must start on a weekday");
    if (!endDate) return toast.error("Choose an end date");
    startTransition(async () => {
      const result = await createSprint(projectKey, {
        name,
        goal: goal || undefined,
        duration,
        startDate,
        endDate: duration === "custom" ? customEnd : undefined,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Sprint created");
      reset();
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create sprint</DialogTitle>
            <DialogDescription>
              Weekends are not counted as working days. Only one sprint can be active at a time.
            </DialogDescription>
          </DialogHeader>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint name" autoFocus />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Goal (optional)</span>
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal" />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Duration</span>
            <select
              className={selectClass}
              value={duration}
              onChange={(e) => setDuration(e.target.value as SprintDurationKey)}
            >
              {Object.entries(SPRINT_DURATIONS).map(([key, d]) => (
                <option key={key} value={key}>
                  {d.label}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Start date</span>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">End date</span>
              <Input
                type="date"
                value={endDate}
                min={startDate || undefined}
                readOnly={duration !== "custom"}
                tabIndex={duration !== "custom" ? -1 : undefined}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </label>
          </div>
          {startsOnWeekend && duration !== "custom" && (
            <p className="text-xs text-danger">Pick a weekday — sprints with a preset duration start on a working day.</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              Create sprint
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
