import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs } from "./session";
import * as issueActions from "@/app/(dashboard)/projects/[projectKey]/actions";

/** JFR-180: bulk actions on the issue list — batch cap, sprint assignment, atomic activity log. */

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => { await destroyWorld(w); });

const make = (key: string, extra: { statusId?: string; sprintId?: string | null } = {}) =>
  prisma.issue.create({
    data: {
      key,
      projectId: w.A.project.id,
      title: key,
      statusId: extra.statusId ?? w.A.statuses.todo.id,
      sprintId: extra.sprintId ?? null,
      reporterId: w.users.aOwner.id,
      position: 1000 + Math.floor(Math.random() * 1e6),
    },
  });

const sprintOf = async (id: string) =>
  (await prisma.issue.findUniqueOrThrow({ where: { id }, select: { sprintId: true } })).sprintId;

describe("bulkUpdateIssueFields batch cap", () => {
  it("rejects more than 100 issues and writes nothing", async () => {
    actAs(w.users.aMember);
    const ids = Array.from({ length: 101 }, (_, i) => `fake-${i}`);
    await expect(issueActions.bulkUpdateIssueFields(w.keyA, ids, { priority: "HIGH" })).rejects.toThrow(/at most 100/i);
  });

  it("de-duplicates ids before counting", async () => {
    actAs(w.users.aMember);
    const issue = await make(`${w.keyA}-801`);
    const ids = Array.from({ length: 150 }, () => issue.id);
    expect(await issueActions.bulkUpdateIssueFields(w.keyA, ids, { priority: "CRITICAL" })).toMatchObject({ count: 1 });
  });
});

describe("bulkUpdateIssueFields sprint (JFR-180)", () => {
  it("is refused on a Kanban project", async () => {
    actAs(w.users.aMember);
    const issue = await make(`${w.keyA}-811`);
    await expect(
      issueActions.bulkUpdateIssueFields(w.keyA, [issue.id], { sprintId: null })
    ).rejects.toThrow(/not in sprint mode/i);
  });

  describe("on a Sprint-mode project", () => {
    let planned: { id: string; name: string };
    let other: { id: string; name: string };
    let completed: { id: string };
    let foreign: { id: string };

    beforeAll(async () => {
      await prisma.project.update({ where: { id: w.A.project.id }, data: { workflowMode: "SPRINT" } });
      planned = await prisma.sprint.create({ data: { projectId: w.A.project.id, name: "Planned", status: "PLANNED" } });
      other = await prisma.sprint.create({ data: { projectId: w.A.project.id, name: "Other", status: "PLANNED" } });
      completed = await prisma.sprint.create({ data: { projectId: w.A.project.id, name: "Done", status: "COMPLETED" } });
      foreign = await prisma.sprint.create({ data: { projectId: w.B.project.id, name: "B sprint", status: "PLANNED" } });
    });

    it("adds, moves and clears sprint membership with one activity entry per changed issue", async () => {
      actAs(w.users.aMember);
      const a = await make(`${w.keyA}-821`);
      const b = await make(`${w.keyA}-822`, { sprintId: planned.id });

      expect(await issueActions.bulkUpdateIssueFields(w.keyA, [a.id, b.id], { sprintId: planned.id })).toMatchObject({ count: 1 });
      expect(await sprintOf(a.id)).toBe(planned.id);
      const addLog = await prisma.activityLog.findFirstOrThrow({ where: { issueId: a.id, field: "sprint" } });
      expect([addLog.oldValue, addLog.newValue]).toEqual(["", "Planned"]);
      expect(await prisma.activityLog.count({ where: { issueId: b.id, field: "sprint" } })).toBe(0);

      expect(await issueActions.bulkUpdateIssueFields(w.keyA, [a.id, b.id], { sprintId: other.id })).toMatchObject({ count: 2 });
      const moveLog = await prisma.activityLog.findFirstOrThrow({ where: { issueId: b.id, field: "sprint" } });
      expect([moveLog.oldValue, moveLog.newValue]).toEqual(["Planned", "Other"]);

      expect(await issueActions.bulkUpdateIssueFields(w.keyA, [a.id, b.id], { sprintId: null })).toMatchObject({ count: 2 });
      expect(await sprintOf(a.id)).toBeNull();
      expect(await sprintOf(b.id)).toBeNull();
    });

    it("rejects a completed sprint and another project's sprint, changing nothing", async () => {
      actAs(w.users.aMember);
      const issue = await make(`${w.keyA}-831`);
      await expect(issueActions.bulkUpdateIssueFields(w.keyA, [issue.id], { sprintId: completed.id })).rejects.toThrow(/completed sprint/i);
      await expect(issueActions.bulkUpdateIssueFields(w.keyA, [issue.id], { sprintId: foreign.id })).rejects.toThrow(/sprint not found/i);
      expect(await sprintOf(issue.id)).toBeNull();
    });

    it("a viewer cannot change sprint membership", async () => {
      actAs(w.users.aViewer);
      await expect(
        issueActions.bulkUpdateIssueFields(w.keyA, [w.A.issue.id], { sprintId: planned.id })
      ).rejects.toThrow(/forbidden|unauthorized|not a project member/i);
      expect(await sprintOf(w.A.issue.id)).toBeNull();
    });

    it("applies status, priority and sprint together with distinct positions and a log row per field", async () => {
      actAs(w.users.aMember);
      const issues = await Promise.all([1, 2, 3].map((n) => make(`${w.keyA}-84${n}`)));
      const ids = issues.map((i) => i.id);

      await issueActions.bulkUpdateIssueFields(w.keyA, ids, {
        statusId: w.A.statuses.prog.id,
        priority: "CRITICAL",
        sprintId: planned.id,
      });

      const rows = await prisma.issue.findMany({ where: { id: { in: ids } }, select: { id: true, statusId: true, position: true, priority: true, sprintId: true } });
      expect(rows.every((r) => r.statusId === w.A.statuses.prog.id && r.priority === "CRITICAL" && r.sprintId === planned.id)).toBe(true);
      const inColumn = await prisma.issue.findMany({ where: { projectId: w.A.project.id, statusId: w.A.statuses.prog.id }, select: { position: true } });
      expect(new Set(inColumn.map((r) => r.position)).size).toBe(inColumn.length);

      for (const field of ["status", "priority", "sprint"]) {
        expect(await prisma.activityLog.count({ where: { issueId: { in: ids }, field } })).toBe(3);
      }
    });
  });
});
