import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs } from "./session";
import * as sprintActions from "@/app/(dashboard)/projects/[projectKey]/sprint-actions";
import { summarizeSprintCompletion } from "@/lib/sprint-completion";

/**
 * JFR-182: the preview the dialog shows is computed by summarizeSprintCompletion; completeSprint decides
 * what to unassign with the same DONE category. These tests run both against real rows and require
 * them to agree, so the dialog can't promise something the server then doesn't do.
 */

let w: World;
beforeAll(async () => {
  w = await createWorld();
  await prisma.project.update({ where: { id: w.A.project.id }, data: { workflowMode: "SPRINT" } });
});
afterAll(async () => { await destroyWorld(w); });

let seq = 0;
async function activeSprintWith(statusIds: string[]) {
  const sprint = await prisma.sprint.create({ data: { projectId: w.A.project.id, name: `S${++seq}`, status: "ACTIVE" } });
  for (const statusId of statusIds) {
    await prisma.issue.create({
      data: {
        key: `${w.keyA}-${600 + ++seq}`, projectId: w.A.project.id, title: `i${seq}`, statusId,
        sprintId: sprint.id, reporterId: w.users.aOwner.id, position: 5000 + seq,
      },
    });
  }
  return sprint;
}

const previewFor = async (sprintId: string) =>
  summarizeSprintCompletion(
    await prisma.issue.findMany({ where: { sprintId }, select: { id: true, projectStatus: { select: { category: true } } } })
  );

describe("completeSprint matches the completion preview", () => {
  it("returns exactly the non-Done issues the preview listed, and keeps the Done ones", async () => {
    const { todo, prog, done } = w.A.statuses;
    const sprint = await activeSprintWith([todo.id, prog.id, done.id, done.id, todo.id]);
    const preview = await previewFor(sprint.id);
    expect(preview.done).toHaveLength(2);
    expect(preview.returning).toHaveLength(3);

    actAs(w.users.aOwner);
    const result = await sprintActions.completeSprint(w.keyA, sprint.id);
    expect(result).toMatchObject({ success: true, movedToBacklogCount: preview.returning.length });

    const stayed = await prisma.issue.findMany({ where: { sprintId: sprint.id }, select: { id: true } });
    expect(stayed.map((i) => i.id).sort()).toEqual(preview.done.map((i) => i.id).sort());
    const returned = await prisma.issue.findMany({ where: { id: { in: preview.returning.map((i) => i.id) } }, select: { sprintId: true } });
    expect(returned.every((i) => i.sprintId === null)).toBe(true);
  });

  it("an all-Done sprint returns nothing, as previewed", async () => {
    const sprint = await activeSprintWith([w.A.statuses.done.id, w.A.statuses.done.id]);
    expect((await previewFor(sprint.id)).returning).toHaveLength(0);
    actAs(w.users.aOwner);
    expect(await sprintActions.completeSprint(w.keyA, sprint.id)).toMatchObject({ success: true, movedToBacklogCount: 0 });
  });

  it("an empty sprint completes with nothing to return", async () => {
    const sprint = await activeSprintWith([]);
    actAs(w.users.aOwner);
    expect(await sprintActions.completeSprint(w.keyA, sprint.id)).toMatchObject({ success: true, movedToBacklogCount: 0 });
  });

  it("uses the DONE *category*, not the status name — a renamed Done status still counts", async () => {
    const renamed = await prisma.projectStatus.create({
      data: { name: "Shipped", projectId: w.A.project.id, category: "DONE", position: 90 },
    });
    const sprint = await activeSprintWith([renamed.id, w.A.statuses.todo.id]);
    const preview = await previewFor(sprint.id);
    expect(preview.done).toHaveLength(1);
    actAs(w.users.aOwner);
    expect(await sprintActions.completeSprint(w.keyA, sprint.id)).toMatchObject({ movedToBacklogCount: 1 });
    expect(await prisma.issue.count({ where: { sprintId: sprint.id } })).toBe(1);
  });

  it("with no DONE-category status at all, everything returns — preview and server agree", async () => {
    const { done } = w.A.statuses;
    await prisma.projectStatus.update({ where: { id: done.id }, data: { category: "IN_PROGRESS" } });
    try {
      const sprint = await activeSprintWith([done.id, w.A.statuses.todo.id]);
      const preview = await previewFor(sprint.id);
      expect(preview.done).toHaveLength(0);
      actAs(w.users.aOwner);
      expect(await sprintActions.completeSprint(w.keyA, sprint.id)).toMatchObject({ movedToBacklogCount: preview.returning.length });
    } finally {
      await prisma.projectStatus.update({ where: { id: done.id }, data: { category: "DONE" } });
    }
  });
});
