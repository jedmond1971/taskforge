"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireProjectRole, canManageSprint, canEditIssues } from "@/lib/permissions";
import { Prisma, Sprint } from "@prisma/client";

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

export async function createSprint(
  projectKey: string,
  data: { name: string; goal?: string }
): Promise<SprintResult<{ sprint: Sprint }>> {
  const { projectId } = await requireProjectRole(projectKey, canManageSprint);

  const modeError = await assertSprintMode(projectId);
  if (modeError) return { success: false, error: modeError };

  const name = data.name.trim();
  if (!name) return { success: false, error: "Sprint name cannot be empty." };

  const existingOpen = await prisma.sprint.findFirst({
    where: { projectId, status: { in: ["PLANNED", "ACTIVE"] } },
    select: { id: true },
  });
  if (existingOpen) return { success: false, error: "This project already has an open sprint." };

  const sprint = await prisma.sprint.create({
    data: { projectId, name, goal: data.goal?.trim() || null, status: "PLANNED" },
  });

  revalidatePath(`/projects/${projectKey}/backlog`);
  return { success: true, sprint };
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
    console.error("startSprint failed:", error);
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
    console.error("completeSprint failed:", error);
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
