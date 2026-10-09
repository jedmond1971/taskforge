import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs, actAsNobody } from "./session";
import * as searchActions from "@/app/(dashboard)/search/actions";
import { paletteSearch as paletteSearchAction } from "@/app/(dashboard)/command-palette-actions";

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

describe("paletteSearch (JFR-176) is tenant- and closed-project-scoped", () => {
  async function search(q: string) {
    const res = await paletteSearchAction(q);
    if (!res.ok) throw new Error(`palette search failed: ${res.error}`);
    return res;
  }

  it("Org B cannot find Org A's issue by exact key, title, or its docs by title", async () => {
    actAs(w.users.bMember);
    expect((await search(w.A.issue.key)).issues).toEqual([]);
    expect((await search(w.A.issue.key.toLowerCase())).issues).toEqual([]);
    // Both orgs have a "... secret issue" / "... secret page"; only B's may come back.
    const secret = await search("secret");
    expect(secret.issues.length).toBeGreaterThan(0);
    expect(secret.issues.every((i) => i.projectKey === w.keyB)).toBe(true);
    expect(secret.docs.length).toBeGreaterThan(0);
    expect(secret.docs.every((d) => d.projectKey === w.keyB)).toBe(true);
    expect((await search(w.keyA)).projects).toEqual([]);
  });

  it("control: the rightful member finds them", async () => {
    actAs(w.users.aViewer);
    expect((await search(w.A.issue.key)).issues[0]?.key).toBe(w.A.issue.key);
    expect((await search(w.keyA)).projects.map((p) => p.key)).toEqual([w.keyA]);
    expect((await search("secret")).docs.map((d) => d.id)).toContain(w.A.page.id);
  });

  it("a closed project's issues, docs and the project itself return nothing, even to its members", async () => {
    await prisma.project.update({ where: { id: w.A.project.id }, data: { isClosed: true } });
    try {
      actAs(w.users.aOwner);
      const byKey = await search(w.A.issue.key);
      expect(byKey.issues).toEqual([]);
      expect((await search("secret")).docs.map((d) => d.id)).not.toContain(w.A.page.id);
      expect((await search(w.keyA)).projects).toEqual([]);
    } finally {
      await prisma.project.update({ where: { id: w.A.project.id }, data: { isClosed: false } });
    }
  });

  it("no session is unauthorized", async () => {
    actAsNobody();
    expect(await paletteSearchAction("secret")).toEqual({ ok: false, error: "unauthorized" });
  });
});

describe("paletteSearch content matches (JFR-194/195) never cross a tenant or closed-project boundary", () => {
  // Distinct from every title in the fixtures, so only the content paths can produce a hit.
  const tokA = () => `ctentA${w.tag}`;
  const tokB = () => `ctentB${w.tag}`;
  let restore: Array<() => Promise<unknown>> = [];

  async function search(q: string) {
    const res = await paletteSearchAction(q);
    if (!res.ok) throw new Error(`palette search failed: ${res.error}`);
    return res;
  }

  beforeAll(async () => {
    const a = w.A, b = w.B;
    await prisma.issue.update({ where: { id: a.issue2.id }, data: { description: `<p>needs ${tokA()} before launch</p>` } });
    await prisma.comment.update({ where: { id: a.comment.id }, data: { body: `<p>remember <strong>${tokA()}</strong></p>` } });
    await prisma.docPage.update({ where: { id: a.page.id }, data: { content: `<h2>Plan</h2><p>about ${tokA()}</p>` } });
    await prisma.issue.update({ where: { id: b.issue2.id }, data: { description: `<p>org b ${tokB()}</p>` } });
    await prisma.docPage.update({ where: { id: b.page.id }, data: { content: `<p>org b doc ${tokB()}</p>` } });
  });
  afterAll(async () => {
    for (const fn of restore) await fn();
    restore = [];
  });

  it("control: a project member finds description, comment and doc text with snippets", async () => {
    actAs(w.users.aViewer);
    const res = await search(tokA());
    const byKind = (k: string) => res.content.filter((c) => c.kind === k);
    expect(byKind("issue").map((c) => c.ref)).toEqual([w.A.issue2.key]);
    expect(byKind("comment").map((c) => c.ref)).toEqual([w.A.issue.key]);
    expect(byKind("doc").map((c) => c.ref)).toEqual([w.A.page.id]);
    for (const c of res.content) {
      expect(c.projectKey).toBe(w.keyA);
      expect(c.snippet.match.toLowerCase()).toBe(tokA().toLowerCase());
    }
    expect(byKind("doc")[0].snippet.before).toBe("Plan about ");
  });

  it("Org B cannot find Org A text through any content path", async () => {
    actAs(w.users.bMember);
    for (const q of [tokA(), tokA().toUpperCase(), tokA().slice(0, 12)]) {
      const res = await search(q);
      expect(res.content, q).toEqual([]);
      expect(res.issues, q).toEqual([]);
      expect(res.docs, q).toEqual([]);
    }
    // Control: B still finds its own.
    const own = await search(tokB());
    expect(own.content.map((c) => c.projectKey)).toEqual([w.keyB, w.keyB]);
    expect(own.content.some((c) => c.kind === "doc" && c.ref === w.B.page.id)).toBe(true);
  });

  it("a same-org user who is not a project member finds nothing, even in a public docspace", async () => {
    const removed = await prisma.projectMember.findFirstOrThrow({ where: { projectId: w.A.project.id, userId: w.users.aAdmin.id } });
    await prisma.projectMember.delete({ where: { id: removed.id } });
    await prisma.docSpace.update({ where: { id: w.A.docSpace.id }, data: { isPublic: true } });
    restore.push(
      () => prisma.projectMember.create({ data: { id: removed.id, userId: removed.userId, projectId: removed.projectId, role: removed.role } }),
      () => prisma.docSpace.update({ where: { id: w.A.docSpace.id }, data: { isPublic: false } }),
    );
    actAs(w.users.aAdmin);
    expect((await search(tokA())).content).toEqual([]);
    for (const fn of restore.splice(0).reverse()) await fn();
  });

  it("a closed project's content is not searchable, even by its members", async () => {
    await prisma.project.update({ where: { id: w.A.project.id }, data: { isClosed: true } });
    try {
      actAs(w.users.aOwner);
      expect((await search(tokA())).content).toEqual([]);
    } finally {
      await prisma.project.update({ where: { id: w.A.project.id }, data: { isClosed: false } });
    }
  });

  it("losing a membership removes content results immediately", async () => {
    const m = await prisma.projectMember.findFirstOrThrow({ where: { projectId: w.A.project.id, userId: w.users.aViewer.id } });
    actAs(w.users.aViewer);
    expect((await search(tokA())).content.length).toBe(3);
    await prisma.projectMember.delete({ where: { id: m.id } });
    try {
      expect((await search(tokA())).content).toEqual([]);
    } finally {
      await prisma.projectMember.create({ data: { id: m.id, userId: m.userId, projectId: m.projectId, role: m.role } });
    }
  });

  it("stored markup comes back as inert text parts", async () => {
    await prisma.comment.update({
      where: { id: w.A.comment.id },
      data: { body: `<p>&lt;img src=x onerror=alert(1)&gt; ${tokA()}<script>alert(2)</script></p>` },
    });
    actAs(w.users.aViewer);
    const hit = (await search(tokA())).content.find((c) => c.kind === "comment")!;
    expect(hit.snippet.before).toContain("<img src=x onerror=alert(1)>"); // literal characters, React escapes on render
    expect(JSON.stringify(hit.snippet)).not.toMatch(/<script/i);
  });
});
