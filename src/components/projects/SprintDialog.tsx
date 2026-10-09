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
import { createSprint, updateSprint } from "@/app/(dashboard)/projects/[projectKey]/sprint-actions";
import {
  SPRINT_DURATIONS,
  SprintDurationKey,
  formatDateOnly,
  inferDuration,
  isWeekend,
  parseDateOnly,
  planFollowingShifts,
  sprintEndDate,
  suggestNextSprint,
} from "@/lib/sprint-dates";

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** The slice of a sprint the dialog needs; `startDate`/`endDate` are ISO strings. */
export type DialogSprint = {
  id: string;
  name: string;
  goal: string | null;
  startDate: string | null;
  endDate: string | null;
};

interface SprintDialogProps {
  projectKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sprint being edited, or null to create one. */
  sprint: DialogSprint | null;
  /** Every open sprint in display order — drives the suggested dates and the shift preview. */
  sprints: DialogSprint[];
}

const toDate = (iso: string | null) => (iso ? new Date(iso) : null);
const toDateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const fmt = (d: Date) => d.toLocaleDateString(undefined, { timeZone: "UTC" });

function initialState(sprint: DialogSprint | null, sprints: DialogSprint[]) {
  if (sprint) {
    const start = toDate(sprint.startDate);
    const end = toDate(sprint.endDate);
    return {
      name: sprint.name,
      goal: sprint.goal ?? "",
      duration: (start && end ? inferDuration(start, end) : "custom") as SprintDurationKey,
      startDate: toDateOnly(sprint.startDate),
      customEnd: toDateOnly(sprint.endDate),
    };
  }
  // A new sprint picks up where the latest one ends, with the same length.
  const next = suggestNextSprint(sprints.map((s) => ({ id: s.id, startDate: toDate(s.startDate), endDate: toDate(s.endDate) })));
  return {
    name: "",
    goal: "",
    duration: (next?.duration ?? "2w") as SprintDurationKey,
    startDate: next ? formatDateOnly(next.startDate) : "",
    customEnd: next ? formatDateOnly(next.endDate) : "",
  };
}

export function SprintDialog({ open, onOpenChange, ...rest }: SprintDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The content only mounts while open, so the form's state re-initialises on every open. */}
      <DialogContent className="sm:max-w-md">
        <SprintForm onClose={() => onOpenChange(false)} {...rest} />
      </DialogContent>
    </Dialog>
  );
}

function SprintForm({
  projectKey,
  sprint,
  sprints,
  onClose,
}: Omit<SprintDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const editing = sprint !== null;
  const [isPending, startTransition] = useTransition();
  const [initial] = useState(() => initialState(sprint, sprints));
  const [name, setName] = useState(initial.name);
  const [goal, setGoal] = useState(initial.goal);
  const [duration, setDuration] = useState<SprintDurationKey>(initial.duration);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [customEnd, setCustomEnd] = useState(initial.customEnd);
  const [shiftPrompt, setShiftPrompt] = useState<{ id: string; name: string; startDate: Date; endDate: Date }[] | null>(null);

  // Derived, not stored: a preset's end date always follows its start date.
  const start = parseDateOnly(startDate);
  const startsOnWeekend = !!start && isWeekend(start);
  const presetEnd =
    duration !== "custom" && start && !startsOnWeekend
      ? formatDateOnly(sprintEndDate(start, SPRINT_DURATIONS[duration].businessDays))
      : "";
  const endDate = duration === "custom" ? customEnd : presetEnd;

  function save(adjustFollowing: boolean) {
    startTransition(async () => {
      const input = { name, goal: goal || undefined, duration, startDate, endDate: duration === "custom" ? customEnd : undefined };
      let adjusted = 0;
      if (sprint) {
        const result = await updateSprint(projectKey, sprint.id, { ...input, adjustFollowing });
        if (!result.success) {
          toast.error(result.error);
          setShiftPrompt(null);
          return;
        }
        adjusted = result.adjustedCount;
      } else {
        const result = await createSprint(projectKey, input);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
      }
      toast.success(
        !sprint
          ? "Sprint created"
          : adjusted > 0
            ? `Sprint updated. ${adjusted} following sprint${adjusted === 1 ? "" : "s"} adjusted.`
            : "Sprint updated"
      );
      onClose();
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Sprint name cannot be empty");
    if (!start) return toast.error("Choose a start date");
    if (startsOnWeekend && duration !== "custom") return toast.error("A sprint must start on a weekday");
    const end = parseDateOnly(endDate);
    if (!end) return toast.error("Choose an end date");
    if (end < start) return toast.error("The end date cannot be before the start date");

    if (sprint && (startDate !== toDateOnly(sprint.startDate) || endDate !== toDateOnly(sprint.endDate))) {
      const names = new Map(sprints.map((s) => [s.id, s.name]));
      const shifts = planFollowingShifts(
        sprints.map((s) => ({ id: s.id, startDate: toDate(s.startDate), endDate: toDate(s.endDate) })),
        sprint.id,
        end
      ).map((s) => ({ ...s, name: names.get(s.id) ?? "Sprint" }));
      if (shifts.length > 0) {
        setShiftPrompt(shifts);
        return;
      }
    }
    save(false);
  }

  if (shiftPrompt) {
    return (
      <div className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Adjust the following sprints?</DialogTitle>
          <DialogDescription>
            These dates now overlap or leave a gap. Each following sprint can start the next working day after the
            previous one ends, keeping its length.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-sm">
          {shiftPrompt.map((s) => (
            <li key={s.id} className="flex justify-between gap-3">
              <span className="text-foreground truncate">{s.name}</span>
              <span className="text-muted-foreground flex-shrink-0">
                {fmt(s.startDate)} – {fmt(s.endDate)}
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setShiftPrompt(null)} disabled={isPending}>
            Back
          </Button>
          <Button type="button" variant="outline" onClick={() => save(false)} disabled={isPending}>
            Only this sprint
          </Button>
          <Button type="button" onClick={() => save(true)} disabled={isPending}>
            Adjust {shiftPrompt.length} sprint{shiftPrompt.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit sprint" : "Create sprint"}</DialogTitle>
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
        <select className={selectClass} value={duration} onChange={(e) => setDuration(e.target.value as SprintDurationKey)}>
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
        <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {editing ? "Save changes" : "Create sprint"}
        </Button>
      </DialogFooter>
    </form>
  );
}
