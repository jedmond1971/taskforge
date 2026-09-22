import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs, actAsNobody } from "./session";
import * as sprintActions from "@/app/(dashboard)/projects/[projectKey]/sprint-actions";

/**
 * SECH-97: sprint actions in SPRINT mode. createWorld() builds KANBAN projects, where every
 * sprint action short-circuits on the mode check — so both projects are switched to SPRINT
 * here, which is the only mode in which the id-scoping below is actually reached.
 */

let w: World;
let sprintA: { id: string };
let sprintB: { id: string };

beforeAll(async () => {
  w = await createWorld();
  await prisma.project.updateMany({ where: { id: { in: [w.A.project.id, w.B.project.id] } }, data: { workflowMode: "SPRINT" } });
  sprintA = await prisma.sprint.create({ data: { projectId: w.A.project.id, name: "A sprint", status: "PLANNED" } });
  sprintB = await prisma.sprint.create({ data: { projectId: w.B.project.id, name: "B sprint", status: "PLANNED" } });
});
afterAll(async () => { await destroyWorld(w); });

const DENIED = /not a project member|forbidden|unauthorized|this project is closed/i;
const failed = async (p: Promise<unknown>, error: RegExp) =>
  expect(await p).toMatchObject({ success: false, error: expect.stringMatching(error) });

async function snapshotA() {
  const [sprints, issues] = await Promise.all([
    prisma.sprint.findMany({ where: { projectId: w.A.project.id }, orderBy: { id: "asc" }, select: { id: true, name: true, status: true, startDate: true, endDate: true } }),
    prisma.issue.findMany({ where: { projectId: w.A.project.id }, orderBy: { key: "asc" }, select: { id: true, sprintId: true } }),
  ]);
  return { sprints, issues };
}

describe("Org B cannot run sprint actions on Org A's project", () => {
  it("every sprint action is denied through Org A's project key and nothing changes", async () => {
    actAs(w.users.bOwner); // PROJECT_LEAD of B — maximal rights in their own tenant
    const before = await snapshotA();
    const k = w.keyA;
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ["createSprint", () => sprintActions.createSprint(k, { name: "pwn" })],
      ["startSprint", () => sprintActions.startSprint(k, sprintA.id)],
      ["completeSprint", () => sprintActions.completeSprint(k, sprintA.id)],
      ["addIssueToSprint", () => sprintActions.addIssueToSprint(k, w.A.issue.id, sprintA.id)],
      ["removeIssueFromSprint", () => sprintActions.removeIssueFromSprint(k, w.A.issue.id)],
    ];
    for (const [name, attempt] of attempts) {
      await expect(attempt(), name).rejects.toThrow(DENIED);
    }
    expect(await snapshotA()).toEqual(before);
  });

  it("Org A sprint and issue ids are rejected through Org B's own project key (IDOR)", async () => {
    await prisma.issue.update({ where: { id: w.A.issue2.id }, data: { sprintId: sprintA.id } });
    try {
      actAs(w.users.bOwner);
      const before = await snapshotA();
      const k = w.keyB;
      await failed(sprintActions.startSprint(k, sprintA.id), /sprint not found/i);
      await failed(sprintActions.completeSprint(k, sprintA.id), /sprint not found/i);
      await failed(sprintActions.addIssueToSprint(k, w.B.issue.id, sprintA.id), /sprint not found/i);
      await failed(sprintActions.addIssueToSprint(k, w.A.issue.id, sprintB.id), /issue not found/i);
      await failed(sprintActions.removeIssueFromSprint(k, w.A.issue2.id), /issue not found/i);
      expect(await snapshotA()).toEqual(before);
      // B's own issue was not pulled into A's sprint either.
      expect((await prisma.issue.findUniqueOrThrow({ where: { id: w.B.issue.id } })).sprintId).toBeNull();
    } finally {
      await prisma.issue.update({ where: { id: w.A.issue2.id }, data: { sprintId: null } });
    }
  });

  it("no session rejects every sprint action", async () => {
    actAsNobody();
    await expect(sprintActions.createSprint(w.keyA, { name: "anon" })).rejects.toThrow(DENIED);
    await expect(sprintActions.addIssueToSprint(w.keyA, w.A.issue.id, sprintA.id)).rejects.toThrow(DENIED);
    await expect(sprintActions.removeIssueFromSprint(w.keyA, w.A.issue.id)).rejects.toThrow(DENIED);
    expect(await prisma.sprint.count({ where: { projectId: w.A.project.id } })).toBe(1);
  });
});

describe("sprint roles inside a tenant", () => {
  it("a TEAM_MEMBER can add/remove issues but cannot create, start or complete sprints", async () => {
    actAs(w.users.aMember);
    const before = await snapshotA();
    await expect(sprintActions.createSprint(w.keyA, { name: "member sprint" })).rejects.toThrow(DENIED);
    await expect(sprintActions.startSprint(w.keyA, sprintA.id)).rejects.toThrow(DENIED);
    await expect(sprintActions.completeSprint(w.keyA, sprintA.id)).rejects.toThrow(DENIED);
    expect(await snapshotA()).toEqual(before);

    expect(await sprintActions.addIssueToSprint(w.keyA, w.A.issue.id, sprintA.id)).toEqual({ success: true });
    expect(await sprintActions.removeIssueFromSprint(w.keyA, w.A.issue.id)).toEqual({ success: true });
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: w.A.issue.id } })).sprintId).toBeNull();
  });

  it("a VIEWER cannot move issues in or out of a sprint", async () => {
    await prisma.issue.update({ where: { id: w.A.issue2.id }, data: { sprintId: sprintA.id } });
    try {
      actAs(w.users.aViewer);
      await expect(sprintActions.addIssueToSprint(w.keyA, w.A.issue.id, sprintA.id)).rejects.toThrow(DENIED);
      await expect(sprintActions.removeIssueFromSprint(w.keyA, w.A.issue2.id)).rejects.toThrow(DENIED);
      const issues = await prisma.issue.findMany({ where: { id: { in: [w.A.issue.id, w.A.issue2.id] } }, orderBy: { key: "asc" }, select: { sprintId: true } });
      expect(issues.map((i) => i.sprintId)).toEqual([null, sprintA.id]);
    } finally {
      await prisma.issue.update({ where: { id: w.A.issue2.id }, data: { sprintId: null } });
    }
  });

  it("a SPRINT_MANAGE group grant lets a TEAM_MEMBER manage sprints, but only in the granted project", async () => {
    const group = await prisma.group.create({ data: { orgId: w.orgA.id, name: `sprinters-${w.tag}` } });
    try {
      await prisma.groupMember.create({ data: { groupId: group.id, userId: w.users.aMember.id } });
      await prisma.groupPermission.create({ data: { groupId: group.id, permission: "SPRINT_MANAGE", projectId: w.A.project.id } });
      actAs(w.users.aMember);
      // An open (PLANNED) sprint already exists, so creation is refused on the business rule —
      // i.e. the grant got the member past the role check.
      await failed(sprintActions.createSprint(w.keyA, { name: "granted" }), /already has an open sprint/i);
      // The grant does nothing for a project the member doesn't belong to.
      await expect(sprintActions.createSprint(w.keyB, { name: "granted elsewhere" })).rejects.toThrow(DENIED);
      expect(await prisma.sprint.count({ where: { projectId: w.B.project.id } })).toBe(1);
    } finally {
      await prisma.group.delete({ where: { id: group.id } });
    }
  });
});

describe("sprint lifecycle for the rightful tenant (control)", () => {
  it("a PROJECT_LEAD can start and complete a sprint; unfinished issues go back to the backlog", async () => {
    actAs(w.users.aOwner);
    expect(await sprintActions.addIssueToSprint(w.keyA, w.A.issue.id, sprintA.id)).toEqual({ success: true });
    expect(await sprintActions.addIssueToSprint(w.keyA, w.A.issue2.id, sprintA.id)).toEqual({ success: true });
    await prisma.issue.update({ where: { id: w.A.issue2.id }, data: { statusId: w.A.statuses.done.id } });

    expect(await sprintActions.startSprint(w.keyA, sprintA.id)).toMatchObject({ success: true, sprint: { status: "ACTIVE" } });
    expect(await sprintActions.completeSprint(w.keyA, sprintA.id)).toEqual({ success: true, movedToBacklogCount: 1 });

    const [open, done] = await Promise.all([
      prisma.issue.findUniqueOrThrow({ where: { id: w.A.issue.id } }),
      prisma.issue.findUniqueOrThrow({ where: { id: w.A.issue2.id } }),
    ]);
    expect(open.sprintId).toBeNull();
    expect(done.sprintId).toBe(sprintA.id);
    // Org B's sprint was never touched by A's lifecycle.
    expect((await prisma.sprint.findUniqueOrThrow({ where: { id: sprintB.id } })).status).toBe("PLANNED");

    await failed(sprintActions.addIssueToSprint(w.keyA, w.A.issue.id, sprintA.id), /completed sprint/i);
  });
});

describe("mode and closed-project guards", () => {
  it("a KANBAN project refuses sprint writes even from its lead", async () => {
    await prisma.project.update({ where: { id: w.B.project.id }, data: { workflowMode: "KANBAN" } });
    try {
      actAs(w.users.bOwner);
      await failed(sprintActions.createSprint(w.keyB, { name: "x" }), /not in sprint mode/i);
      await failed(sprintActions.startSprint(w.keyB, sprintB.id), /not in sprint mode/i);
      await failed(sprintActions.addIssueToSprint(w.keyB, w.B.issue.id, sprintB.id), /not in sprint mode/i);
      expect((await prisma.sprint.findUniqueOrThrow({ where: { id: sprintB.id } })).status).toBe("PLANNED");
    } finally {
      await prisma.project.update({ where: { id: w.B.project.id }, data: { workflowMode: "SPRINT" } });
    }
  });

  it("a closed project write-locks sprint actions (SECH-93)", async () => {
    await prisma.project.update({ where: { id: w.B.project.id }, data: { isClosed: true } });
    try {
      actAs(w.users.bOwner);
      await expect(sprintActions.startSprint(w.keyB, sprintB.id)).rejects.toThrow(/closed/i);
      actAs(w.users.bMember);
      await expect(sprintActions.addIssueToSprint(w.keyB, w.B.issue.id, sprintB.id)).rejects.toThrow(/closed/i);
      expect((await prisma.sprint.findUniqueOrThrow({ where: { id: sprintB.id } })).status).toBe("PLANNED");
      expect((await prisma.issue.findUniqueOrThrow({ where: { id: w.B.issue.id } })).sprintId).toBeNull();
    } finally {
      await prisma.project.update({ where: { id: w.B.project.id }, data: { isClosed: false } });
    }
  });
});
