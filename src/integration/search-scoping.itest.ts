import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs, actAsNobody } from "./session";
import * as searchActions from "@/app/(dashboard)/search/actions";

/**
 * SECH-97: the query-language search (runQuery) and its autocomplete. The user writes the WHERE
 * clause, so every query below is an attempt to name, match or OR its way into Org A's issues;
 * the executor must AND the caller's ProjectMember scope onto all of them.
 */

let w: World;
const LABEL = () => `a-only-label-${w.tag}`;
beforeAll(async () => {
  w = await createWorld();
  await prisma.issue.update({ where: { id: w.A.issue.id }, data: { labels: [LABEL()], assigneeId: w.users.aOwner.id } });
});
afterAll(async () => { await destroyWorld(w); });

async function keysFor(query: string) {
  const res = await searchActions.runQuery(query);
  if (!res.success) throw new Error(`query failed: ${query}: ${JSON.stringify(res.errors)}`);
  return res.data.issues.map((i) => i.key).sort();
}

describe("runQuery is scoped to the caller's project memberships", () => {
  it("no query can reach another org's issues", async () => {
    actAs(w.users.bMember);
    const ownKeys = [w.B.issue.key, w.B.issue2.key].sort();
    const probes: Array<[string, string[]]> = [
      [`project = "${w.keyA}"`, []],
      [`project IN ("${w.keyA}", "${w.keyB}")`, ownKeys],
      [`key = "${w.A.issue.key}"`, []],
      [`key IN ("${w.A.issue.key}", "${w.B.issue.key}")`, [w.B.issue.key]],
      [`project = "${w.keyA}" OR project = "${w.keyB}"`, ownKeys],
      [`project != "${w.keyB}"`, []],
      [`title ~ "secret"`, [w.B.issue.key]], // both orgs have a "... secret issue"
      [`labels = "${LABEL()}"`, []],
      [`assignee = "${w.users.aOwner.email}"`, []],
      [`reporter = "${w.users.aOwner.email}"`, []],
      // A tautology that would match every issue in the database without the scope filter.
      [`(project = "${w.keyA}" OR priority = "MEDIUM") OR priority != "MEDIUM"`, ownKeys],
      [`ORDER BY createdAt DESC`, ownKeys],
    ];
    for (const [query, expected] of probes) {
      expect(await keysFor(query), query).toEqual(expected);
    }
  });

  it("control: the rightful member finds the same issues", async () => {
    actAs(w.users.aViewer);
    expect(await keysFor(`labels = "${LABEL()}"`)).toEqual([w.A.issue.key]);
    expect(await keysFor(`project = "${w.keyA}"`)).toEqual([w.A.issue.key, w.A.issue2.key].sort());
  });

  it("a user with no project memberships gets nothing, and losing a membership removes results immediately", async () => {
    const loner = await prisma.user.create({ data: { name: "loner", email: `${w.tag}-loner@itest.local`, passwordHash: "x" } });
    try {
      await prisma.orgMember.create({ data: { orgId: w.orgA.id, userId: loner.id, role: "MEMBER" } });
      actAs({ id: loner.id, name: loner.name, email: loner.email, role: loner.role, orgId: w.orgA.id });
      // Org membership alone is not project visibility.
      expect(await keysFor(`project = "${w.keyA}"`)).toEqual([]);
      await prisma.projectMember.create({ data: { userId: loner.id, projectId: w.A.project.id, role: "VIEWER" } });
      expect(await keysFor(`project = "${w.keyA}"`)).toHaveLength(2);
      await prisma.projectMember.deleteMany({ where: { userId: loner.id } });
      expect(await keysFor(`project = "${w.keyA}"`)).toEqual([]);
    } finally {
      await prisma.orgMember.deleteMany({ where: { userId: loner.id } });
      await prisma.user.delete({ where: { id: loner.id } });
    }
  });

  it("no session throws", async () => {
    actAsNobody();
    await expect(searchActions.runQuery(`project = "${w.keyA}"`)).rejects.toThrow(/unauthorized/i);
    await expect(searchActions.getAutocompleteSuggestions("project = ", 10)).rejects.toThrow(/unauthorized/i);
  });
});

describe("autocomplete suggestions never reveal another org's values", () => {
  const suggest = (q: string) => searchActions.getAutocompleteSuggestions(q, q.length);

  it("project keys, user emails and labels come only from the caller's projects", async () => {
    actAs(w.users.bMember);
    const projects = (await suggest("project = ")).suggestions;
    expect(projects).toContain(`"${w.keyB}"`);
    expect(projects).not.toContain(`"${w.keyA}"`);

    const aEmails = [w.users.aOwner, w.users.aMember, w.users.aViewer, w.users.aAdmin].map((u) => `"${u.email}"`);
    for (const field of ["assignee", "reporter"]) {
      const s = (await suggest(`${field} = `)).suggestions;
      expect(s).toContain(`"${w.users.bOwner.email}"`);
      for (const e of aEmails) expect(s, field).not.toContain(e);
    }
    expect((await suggest("labels = ")).suggestions).not.toContain(`"${LABEL()}"`);
    // Inside an unfinished string literal takes a different code path — same scoping.
    expect((await suggest('project = "IT')).suggestions).not.toContain(`"${w.keyA}"`);
  });

  it("control: Org A's member does see Org A's values", async () => {
    actAs(w.users.aMember);
    expect((await suggest("project = ")).suggestions).toContain(`"${w.keyA}"`);
    expect((await suggest("labels = ")).suggestions).toContain(`"${LABEL()}"`);
  });
});
