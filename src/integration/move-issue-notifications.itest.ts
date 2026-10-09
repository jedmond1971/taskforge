import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs } from "./session";
import * as issueActions from "@/app/(dashboard)/projects/[projectKey]/actions";

/** JFR-184: a board drag (moveIssue) now fires STATUS_CHANGED like updateIssue does. */

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => { await destroyWorld(w); });

const make = (key: string, assigneeId: string | null, reporterId: string) =>
  prisma.issue.create({
    data: { key, projectId: w.A.project.id, title: key, statusId: w.A.statuses.todo.id, reporterId, assigneeId, position: 2000 + Math.floor(Math.random() * 1e6) },
  });

const statusNotes = (issueId: string, userId: string) =>
  prisma.notification.findMany({ where: { issueId, userId, type: "STATUS_CHANGED" } });

describe("moveIssue status-change notifications (JFR-184)", () => {
  it("notifies the assignee and the reporter, but not the user who dragged", async () => {
    // aMember drags; aOwner reported it, aAdmin is assigned.
    const issue = await make(`${w.keyA}-701`, w.users.aAdmin.id, w.users.aOwner.id);
    actAs(w.users.aMember);

    await issueActions.moveIssue(w.keyA, issue.id, w.A.statuses.prog.id, 0);

    const [assignee] = await statusNotes(issue.id, w.users.aAdmin.id);
    expect(assignee.message).toBe(`${issue.key} status changed to ${w.A.statuses.prog.name}`);
    expect(await statusNotes(issue.id, w.users.aOwner.id)).toHaveLength(1);
    expect(await statusNotes(issue.id, w.users.aMember.id)).toHaveLength(0);
  });

  it("does not notify the dragger even when they are the assignee", async () => {
    const issue = await make(`${w.keyA}-702`, w.users.aMember.id, w.users.aOwner.id);
    actAs(w.users.aMember);
    await issueActions.moveIssue(w.keyA, issue.id, w.A.statuses.done.id, 0);
    expect(await statusNotes(issue.id, w.users.aMember.id)).toHaveLength(0);
    expect(await statusNotes(issue.id, w.users.aOwner.id)).toHaveLength(1);
  });

  it("is silent for a within-column reorder and for an unassigned issue the dragger reported", async () => {
    const issue = await make(`${w.keyA}-703`, null, w.users.aMember.id);
    actAs(w.users.aMember);
    await issueActions.moveIssue(w.keyA, issue.id, w.A.statuses.todo.id, 0); // same status
    await issueActions.moveIssue(w.keyA, issue.id, w.A.statuses.prog.id, 0); // moved, but nobody to tell
    expect(await prisma.notification.count({ where: { issueId: issue.id } })).toBe(0);
  });
});
