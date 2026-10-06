"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireProjectRole, canManageSprint, canEditIssues } from "@/lib/permissions";
import { Prisma, Sprint } from "@prisma/client";
import { logError } from "@/lib/security-events";
import {
  SPRINT_DURATIONS,
  SprintDurationKey,
  isWeekend,
  orderSprints,
  parseDateOnly,
  planFollowingShifts,
  sprintEndDate,
} from "@/lib/sprint-dates";

type SprintResult<T extends object = object> =
  | ({ success: true } & T)
  | { success: false; error: string };

async function assertSprintMode(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { workflowMode: true },
  });
  return project.workflowMode === "SPRINT" ? null : "This project is not in Sprint mode.";
}

type SprintInput = {
  name: string;
  goal?: string;
  duration: SprintDurationKey;
  /** `YYYY-MM-DD` */
  startDate: string;
  /** `YYYY-MM-DD`; required for `custom`, ignored (recomputed) for the presets. */
  endDate?: string;
};

// Shared by create and edit: every field but the goal is required.
function resolveSprintInput(
  data: SprintInput
): { error: string } | { name: string; goal: string | null; startDate: Date; endDate: Date } {
  const name = data.name.trim();
  if (!name) return { error: "Sprint name cannot be empty." };

  const startDate = parseDateOnly(data.startDate);
  if (!startDate) return { error: "Enter a valid start date." };

  let endDate: Date;
  if (data.duration === "custom") {
    const parsedEnd = data.endDate ? parseDateOnly(data.endDate) : null;
    if (!parsedEnd) return { error: "Enter a valid end date." };
    if (parsedEnd < startDate) return { error: "The end date cannot be before the start date." };
    endDate = parsedEnd;
  } else {
    // Own-property check: the key comes from the client, and "constructor" etc.
    // would otherwise resolve on the prototype.
    if (!Object.hasOwn(SPRINT_DURATIONS, data.duration)) return { error: "Choose a sprint duration." };
    if (isWeekend(startDate)) return { error: "A sprint must start on a weekday." };
    endDate = sprintEndDate(startDate, SPRINT_DURATIONS[data.duration].businessDays);
  }
  return { name, goal: data.goal?.trim() || null, startDate, endDate };
}

export async function createSprint(
  projectKey: string,
  data: SprintInput
): Promise<SprintResult<{ sprint: Sprint }>> {
  const { projectId } = await requireProjectRole(projectKey, canManageSprint);

  const modeError = await assertSprintMode(projectId);
  if (modeError) return { success: false, error: modeError };

  const input = resolveSprintInput(data);
  if ("error" in input) return { success: false, error: input.error };

  // Any number of sprints may be planned; only one may be ACTIVE (see startSprint).
  // Once the user has hand-ordered the sprints, a new one joins the end of that order.
  const open = await prisma.sprint.findMany({
    where: { projectId, status: { in: ["PLANNED", "ACTIVE"] } },
    select: { position: true },
  });
  const positions = open.map((s) => s.position).filter((p): p is number => p !== null);
  const position = positions.length > 0 ? Math.max(...positions) + 1 : null;

  const sprint = await prisma.sprint.create({
    data: { projectId, ...input, status: "PLANNED", position },
  });

  revalidatePath(`/projects/${projectKey}/backlog`);
  return { success: true, sprint };
}

export async function updateSprint(
  projectKey: string,
  sprintId: string,
  data: SprintInput & { adjustFollowing?: boolean }
): Promise<SprintResult<{ sprint: Sprint; adjustedCount: number }>> {
  const { projectId } = await requireProjectRole(projectKey, canManageSprint);

  const modeError = await assertSprintMode(projectId);
  if (modeError) return { success: false, error: modeError };

  const target = await prisma.sprint.findFirst({ where: { id: sprintId, projectId } });
  if (!target) return { success: false, error: "Sprint not found." };
  if (target.status === "COMPLETED") return { success: false, error: "A completed sprint cannot be edited." };

  const input = resolveSprintInput(data);
  if ("error" in input) return { success: false, error: input.error };

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Read the order the user was looking at *before* the edit — a new start date
      // could otherwise re-sort the default order and change who counts as "following".
      const open = await tx.sprint.findMany({
        where: { projectId, status: { in: ["PLANNED", "ACTIVE"] } },
      });
      const sprint = await tx.sprint.update({ where: { id: sprintId }, data: input });

      let adjustedCount = 0;
      if (data.adjustFollowing === true) {
        const shifts = planFollowingShifts(orderSprints(open), sprintId, input.endDate);
        for (const shift of shifts) {
          await tx.sprint.update({
            where: { id: shift.id },
            data: { startDate: shift.startDate, endDate: shift.endDate },
          });
        }
        adjustedCount = shifts.length;
      }
      return { sprint, adjustedCount };
    });

    revalidatePath(`/projects/${projectKey}/backlog`);
    return { success: true, ...result };
  } catch (error) {
    logError("updateSprint failed", error);
    throw new Error("Failed to update sprint — please retry");
  }
}

export async function reorderSprints(
  projectKey: string,
  orderedIds: string[]
): Promise<SprintResult> {
  const { projectId } = await requireProjectRole(projectKey, canManageSprint);

  const modeError = await assertSprintMode(projectId);
  if (modeError) return { success: false, error: modeError };

  try {
    const error = await prisma.$transaction(async (tx) => {
      const open = await tx.sprint.findMany({
        where: { projectId, status: { in: ["PLANNED", "ACTIVE"] } },
        select: { id: true },
      });
      // The list must be exactly the project's open sprints — a stale view (a sprint was
      // created or completed meanwhile) or a foreign id is rejected rather than half-applied.
      const known = new Set(open.map((s) => s.id));
      if (orderedIds.length !== known.size || new Set(orderedIds).size !== known.size || !orderedIds.every((id) => known.has(id))) {
        return "The sprint list is out of date — refresh and try again.";
      }
      for (const [position, id] of orderedIds.entries()) {
        await tx.sprint.update({ where: { id }, data: { position } });
      }
      return null;
    });
    if (error) return { success: false, error };
  } catch (error) {
    logError("reorderSprints failed", error);
    throw new Error("Failed to reorder sprints — please retry");
  }

  revalidatePath(`/projects/${projectKey}/backlog`);
  return { success: true };
}

export async function startSprint(
  projectKey: string,
  sprintId: string
): Promise<SprintResult<{ sprint: Sprint }>> {
  const { projectId } = await requireProjectRole(projectKey, canManageSprint);

  const modeError = await assertSprintMode(projectId);
  if (modeError) return { success: false, error: modeError };

  const target = await prisma.sprint.findFirst({ where: { id: sprintId, projectId } });
  if (!target) return { success: false, error: "Sprint not found." };
  if (target.status !== "PLANNED") return { success: false, error: "Only a planned sprint can be started." };

  // App-level pre-check purely for a clean error message — the partial
  // unique index (Sprint_projectId_active_key) is the real race guard.
  const activeAlready = await prisma.sprint.findFirst({
    where: { projectId, status: "ACTIVE" },
    select: { id: true },
  });
  if (activeAlready) return { success: false, error: "This project already has an active sprint." };

  try {
    const sprint = await prisma.sprint.update({
      where: { id: sprintId },
      data: { status: "ACTIVE", startDate: target.startDate ?? new Date() },
    });
    revalidatePath(`/projects/${projectKey}/backlog`);
    revalidatePath(`/projects/${projectKey}/board`);
    return { success: true, sprint };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Lost the race to a concurrent start.
      return { success: false, error: "This project already has an active sprint." };
    }
    logError("startSprint failed", error);
    throw new Error("Failed to start sprint — please retry");
  }
}

export async function completeSprint(
  projectKey: string,
  sprintId: string
): Promise<SprintResult<{ movedToBacklogCount: number }>> {
  const { projectId } = await requireProjectRole(projectKey, canManageSprint);

  const modeError = await assertSprintMode(projectId);
  if (modeError) return { success: false, error: modeError };

  const target = await prisma.sprint.findFirst({ where: { id: sprintId, projectId } });
  if (!target) return { success: false, error: "Sprint not found." };
  if (target.status !== "ACTIVE") return { success: false, error: "Only the active sprint can be completed." };

  try {
    const movedToBacklogCount = await prisma.$transaction(async (tx) => {
      const doneStatuses = await tx.projectStatus.findMany({
        where: { projectId, category: "DONE" },
        select: { id: true },
      });
      const doneStatusIds = doneStatuses.map((s) => s.id);

      // notIn: [] matches everything, correctly unassigning all issues if the
      // project happens to have no DONE-category status at all.
      const { count } = await tx.issue.updateMany({
        where: { projectId, sprintId, statusId: { notIn: doneStatusIds } },
        data: { sprintId: null },
      });

      await tx.sprint.update({
        where: { id: sprintId },
        data: { status: "COMPLETED", endDate: target.endDate ?? new Date() },
      });

      return count;
    });

    revalidatePath(`/projects/${projectKey}/backlog`);
    revalidatePath(`/projects/${projectKey}/board`);
    return { success: true, movedToBacklogCount };
  } catch (error) {
    logError("completeSprint failed", error);
    throw new Error("Failed to complete sprint — please retry");
  }
}

export async function addIssueToSprint(
  projectKey: string,
  issueId: string,
  sprintId: string
): Promise<SprintResult> {
  const { projectId } = await requireProjectRole(projectKey, canEditIssues);

  const modeError = await assertSprintMode(projectId);
  if (modeError) return { success: false, error: modeError };

  const sprint = await prisma.sprint.findFirst({
    where: { id: sprintId, projectId },
    select: { status: true },
  });
  if (!sprint) return { success: false, error: "Sprint not found." };
  if (sprint.status === "COMPLETED") return { success: false, error: "Cannot add issues to a completed sprint." };

  const { count } = await prisma.issue.updateMany({
    where: { id: issueId, projectId },
    data: { sprintId },
  });
  if (count === 0) return { success: false, error: "Issue not found." };

  revalidatePath(`/projects/${projectKey}/backlog`);
  revalidatePath(`/projects/${projectKey}/board`);
  return { success: true };
}

export async function removeIssueFromSprint(
  projectKey: string,
  issueId: string
): Promise<SprintResult> {
  const { projectId } = await requireProjectRole(projectKey, canEditIssues);

  const { count } = await prisma.issue.updateMany({
    where: { id: issueId, projectId },
    data: { sprintId: null },
  });
  if (count === 0) return { success: false, error: "Issue not found." };

  revalidatePath(`/projects/${projectKey}/backlog`);
  revalidatePath(`/projects/${projectKey}/board`);
  return { success: true };
}
