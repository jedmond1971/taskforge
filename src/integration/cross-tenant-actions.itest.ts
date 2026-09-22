import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs, actAsNobody } from "./session";
import * as issueActions from "@/app/(dashboard)/projects/[projectKey]/actions";
import * as sprintActions from "@/app/(dashboard)/projects/[projectKey]/sprint-actions";
import * as boardActions from "@/app/(dashboard)/projects/[projectKey]/settings/board-actions";
import * as fieldActions from "@/app/(dashboard)/projects/[projectKey]/settings/custom-field-actions";
import * as fieldLayoutActions from "@/app/(dashboard)/projects/[projectKey]/settings/custom-field-layout-actions";
import * as fieldValueActions from "@/app/(dashboard)/projects/[projectKey]/issues/[issueKey]/custom-field-value-actions";
import * as apiKeyActions from "@/app/(dashboard)/org-settings/actions";
import * as groupActions from "@/app/(dashboard)/org-settings/group-actions";
import * as filterActions from "@/app/(dashboard)/search/filter-actions";
import * as adminActions from "@/app/(dashboard)/admin/actions";
import * as closedActions from "@/app/(dashboard)/projects/closed-actions";

/**
 * SECH-85: negative tests for session-authenticated server actions. Two real tenants
 * (Org A / Org B) in a real Postgres; the "logged in" user is the only thing faked.
 * Every test here must FAIL CLOSED: the actor is denied AND nothing of the victim changed.
 */

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => { await destroyWorld(w); });

const DENIED =
  /not a project member|not an organization member|forbidden|unauthorized|not found|do not have access|invalid status|failed to move|not in this project|not a member|does not belong|this project is closed/i;
const denied = (p: Promise<unknown>) => expect(p).rejects.toThrow(DENIED);
const failedResult = async (p: Promise<unknown>) => expect(await p).toMatchObject({ success: false });

// Everything a cross-tenant attacker might have changed on Org A's side.
async function snapshotA() {
  const [issues, comment, project, members, statuses, key, group, field] = await Promise.all([
    prisma.issue.findMany({ where: { projectId: w.A.project.id }, orderBy: { key: "asc" }, select: { id: true, key: true, title: true, priority: true, statusId: true, parentId: true, projectId: true, reporterId: true } }),
    prisma.comment.findUnique({ where: { id: w.A.comment.id } }),
    prisma.project.findUnique({ where: { id: w.A.project.id }, select: { name: true, orgId: true, isPrivate: true, isClosed: true } }),
    prisma.projectMember.findMany({ where: { projectId: w.A.project.id }, orderBy: { id: "asc" }, select: { id: true, userId: true, role: true } }),
    prisma.projectStatus.findMany({ where: { projectId: w.A.project.id }, orderBy: { name: "asc" }, select: { id: true, name: true, position: true } }),
    prisma.apiKey.findUnique({ where: { id: w.apiKeyA.id }, select: { revokedAt: true } }),
    prisma.group.findUnique({ where: { id: w.groupA.id }, select: { name: true } }),
    prisma.customField.findUnique({ where: { id: w.customFieldA.id }, select: { name: true } }),
  ]);
  return { issues, comment, project, members, statuses, key, group, field };
}

describe("Org B user cannot touch Org A's project (foreign project key)", () => {
  beforeEach(() => actAs(w.users.bMember));

  it("every read and write is denied and Org A is left untouched", async () => {
    const before = await snapshotA();
    const k = w.keyA, a = w.A;
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ["getIssues", () => issueActions.getIssues(k)],
      ["getIssue", () => issueActions.getIssue(k, a.issue.key)],
      ["getProjectMembers", () => issueActions.getProjectMembers(k)],
      ["getProjectStatuses", () => issueActions.getProjectStatuses(k)],
      ["getIssuesHierarchy", () => issueActions.getIssuesHierarchy(k)],
      ["searchIssuesForLinking", () => issueActions.searchIssuesForLinking(k, "ITA", "")],
      ["searchIssuesForParent", () => issueActions.searchIssuesForParent(k, "ITA", "")],
      ["createIssue", () => issueActions.createIssue(k, { title: "pwn" })],
      ["updateIssue", () => issueActions.updateIssue(k, a.issue.id, { title: "pwn" })],
      ["bulkUpdateIssueFields", () => issueActions.bulkUpdateIssueFields(k, [a.issue.id], { priority: "CRITICAL" })],
      ["deleteIssue", () => issueActions.deleteIssue(k, a.issue.id)],
      ["addComment", () => issueActions.addComment(k, a.issue.id, "pwn")],
      ["updateComment", () => issueActions.updateComment(k, a.comment.id, "pwn")],
      ["deleteComment", () => issueActions.deleteComment(k, a.comment.id)],
      ["linkIssue", () => issueActions.linkIssue(k, a.issue.id, a.issue2.id, "BLOCKS")],
      ["unlinkIssue", () => issueActions.unlinkIssue(k, "nope")],
      ["setIssueParent", () => issueActions.setIssueParent(k, a.issue.id, a.issue2.id)],
      ["moveIssue", () => issueActions.moveIssue(k, a.issue.id, a.statuses.done.id, 0)],
      ["reorderIssues", () => issueActions.reorderIssues(k, [a.issue.id, a.issue2.id])],
      ["updateProject", () => issueActions.updateProject(k, { name: "pwn" })],
      ["deleteProject", () => issueActions.deleteProject(k)],
      ["addProjectMember", () => issueActions.addProjectMember(k, w.users.bMember.id, "PROJECT_LEAD")],
      ["removeProjectMember", () => issueActions.removeProjectMember(k, a.memberships[w.users.aMember.id].id)],
      ["changeMemberRole", () => issueActions.changeMemberRole(k, a.memberships[w.users.aMember.id].id, "VIEWER")],
      ["searchUsers", () => issueActions.searchUsers("a", k)],
      ["createUserAndAddToProject", () => issueActions.createUserAndAddToProject(k, { name: "x", email: `${w.tag}-evil@itest.local`, password: "password123", role: "PROJECT_LEAD" })],
      ["linkDocPage", () => issueActions.linkDocPage(k, a.issue.id, a.page.id)],
      ["unlinkDocPage", () => issueActions.unlinkDocPage(k, a.issue.id, a.page.id)],
      ["createSprint", () => sprintActions.createSprint(k, { name: "pwn" })],
      ["createProjectStatus", () => boardActions.createProjectStatus(k, { name: "pwn", category: "TODO" })],
      ["renameProjectStatus", () => boardActions.renameProjectStatus(k, a.statuses.todo.id, "pwn")],
      ["deleteProjectStatus", () => boardActions.deleteProjectStatus(k, a.statuses.prog.id)],
      ["getApplicableCustomFields", () => fieldValueActions.getApplicableCustomFields(k)],
      ["getCustomFieldValues", () => fieldValueActions.getCustomFieldValues(k, a.issue.id)],
      ["setCustomFieldValue", () => fieldValueActions.setCustomFieldValue(k, a.issue.id, w.customFieldA.id, "pwn")],
      ["getProjectFieldLayout", () => fieldLayoutActions.getProjectFieldLayout(k)],
    ];
    for (const [name, attempt] of attempts) {
      await expect(attempt(), name).rejects.toThrow(DENIED);
    }
    // sprint actions return a failure result only after the role check, so they throw too;
    // anything that slipped through would show up as a diff here.
    expect(await snapshotA()).toEqual(before);
    expect(await prisma.user.count({ where: { email: `${w.tag}-evil@itest.local` } })).toBe(0);
  });
});

describe("Org B user cannot reach Org A objects by id through their OWN project key (IDOR)", () => {
  beforeEach(() => actAs(w.users.bOwner)); // a legitimate PROJECT_LEAD of Org B's project

  it("issue, comment, link, member and status ids from Org A are rejected and unchanged", async () => {
    const link = await prisma.issueLink.create({
      data: { sourceIssueId: w.A.issue.id, targetIssueId: w.A.issue2.id, linkType: "RELATES_TO", createdById: w.users.aOwner.id },
    });
    const before = await snapshotA();
    const k = w.keyB, a = w.A, b = w.B;
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ["updateIssue", () => issueActions.updateIssue(k, a.issue.id, { title: "pwn" })],
      ["deleteIssue", () => issueActions.deleteIssue(k, a.issue.id)],
      ["bulkUpdateIssueFields", () => issueActions.bulkUpdateIssueFields(k, [a.issue.id], { priority: "CRITICAL" })],
      ["addComment", () => issueActions.addComment(k, a.issue.id, "pwn")],
      ["updateComment", () => issueActions.updateComment(k, a.comment.id, "pwn")],
      ["deleteComment", () => issueActions.deleteComment(k, a.comment.id)],
      ["linkIssue (target in A)", () => issueActions.linkIssue(k, b.issue.id, a.issue.id, "BLOCKS")],
      ["unlinkIssue", () => issueActions.unlinkIssue(k, link.id)],
      ["setIssueParent (parent in A)", () => issueActions.setIssueParent(k, b.issue.id, a.issue.id)],
      ["moveIssue (issue in A)", () => issueActions.moveIssue(k, a.issue.id, b.statuses.done.id, 0)],
      ["removeProjectMember", () => issueActions.removeProjectMember(k, a.memberships[w.users.aMember.id].id)],
      ["changeMemberRole", () => issueActions.changeMemberRole(k, a.memberships[w.users.aMember.id].id, "VIEWER")],
      ["addProjectMember (user from Org A)", () => issueActions.addProjectMember(k, w.users.aMember.id, "TEAM_MEMBER")],
      ["renameProjectStatus", () => boardActions.renameProjectStatus(k, a.statuses.todo.id, "pwn")],
      ["deleteProjectStatus", () => boardActions.deleteProjectStatus(k, a.statuses.prog.id)],
      ["reorderProjectStatuses", () => boardActions.reorderProjectStatuses(k, [{ id: a.statuses.todo.id, position: 9 }])],
      ["setCustomFieldValue (issue in A)", () => fieldValueActions.setCustomFieldValue(k, a.issue.id, w.customFieldA.id, "pwn")],
      ["getCustomFieldValues (issue in A)", () => fieldValueActions.getCustomFieldValues(k, a.issue.id)],
      ["linkDocPage (page in A)", () => issueActions.linkDocPage(k, b.issue.id, a.page.id)],
    ];
    for (const [name, attempt] of attempts) {
      await expect(attempt(), name).rejects.toThrow(DENIED);
    }
    expect(await snapshotA()).toEqual(before);
    expect(await prisma.issueLink.count({ where: { id: link.id } })).toBe(1);
    expect(await prisma.projectMember.count({ where: { userId: w.users.aMember.id, projectId: w.B.project.id } })).toBe(0);
  });
});

describe("org-level actions (API keys, groups, custom fields)", () => {
  beforeEach(() => actAs(w.users.bOwner)); // OWNER of Org B

  it("an Org B owner is denied on Org A's orgId", async () => {
    const before = await snapshotA();
    const o = w.orgA.id;
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ["listApiKeys", () => apiKeyActions.listApiKeys(o)],
      ["createApiKey", () => apiKeyActions.createApiKey(o, "pwn")],
      ["revokeApiKey", () => apiKeyActions.revokeApiKey(o, w.apiKeyA.id)],
      ["listGroups", () => groupActions.listGroups(o)],
      ["createGroup", () => groupActions.createGroup(o, "pwn")],
      ["deleteGroup", () => groupActions.deleteGroup(o, w.groupA.id)],
      ["searchOrgMembersForGroup", () => groupActions.searchOrgMembersForGroup(o, w.groupA.id, "")],
      ["getCustomFields", () => fieldActions.getCustomFields(o)],
      ["createCustomField", () => fieldActions.createCustomField(o, { name: "pwn", type: "TEXT" }, w.keyB)],
      ["deleteCustomField", () => fieldActions.deleteCustomField(o, w.customFieldA.id, w.keyB)],
    ];
    for (const [name, attempt] of attempts) {
      await expect(attempt(), name).rejects.toThrow(DENIED);
    }
    expect(await snapshotA()).toEqual(before);
  });

  it("their own orgId does not unlock Org A's api key, group or custom field ids", async () => {
    const before = await snapshotA();
    const o = w.orgB.id;
    await failedResult(apiKeyActions.revokeApiKey(o, w.apiKeyA.id));
    await failedResult(groupActions.renameGroup(o, w.groupA.id, "pwn"));
    await failedResult(groupActions.deleteGroup(o, w.groupA.id));
    await failedResult(groupActions.addGroupMember(o, w.groupA.id, w.users.bMember.id));
    await failedResult(groupActions.removeGroupMember(o, w.groupA.id, w.users.aMember.id));
    await failedResult(groupActions.setGroupPermission(o, w.groupA.id, "ISSUE_EDIT", null));
    await failedResult(groupActions.removeGroupPermission(o, "nope"));
    await expect(fieldActions.updateCustomField(o, w.customFieldA.id, { name: "pwn" }, w.keyB)).rejects.toThrow(/not found/i);
    await expect(fieldActions.deleteCustomField(o, w.customFieldA.id, w.keyB)).rejects.toThrow(/not found/i);
    expect(await snapshotA()).toEqual(before);
  });

  it("a group grant can only be scoped to a project inside the group's own org", async () => {
    const own = await prisma.group.create({ data: { orgId: w.orgB.id, name: `own-${w.tag}` } });
    await failedResult(groupActions.setGroupPermission(w.orgB.id, own.id, "ISSUE_EDIT", w.A.project.id));
    expect(await prisma.groupPermission.count({ where: { groupId: own.id } })).toBe(0);
  });

  it("addGroupMember refuses a user who is not in the group's org", async () => {
    const own = await prisma.group.create({ data: { orgId: w.orgB.id, name: `own2-${w.tag}` } });
    await failedResult(groupActions.addGroupMember(w.orgB.id, own.id, w.users.aMember.id));
    expect(await prisma.groupMember.count({ where: { groupId: own.id } })).toBe(0);
  });
});

describe("role enforcement inside a tenant", () => {
  it("a VIEWER cannot create or edit issues", async () => {
    actAs(w.users.aViewer);
    await denied(issueActions.createIssue(w.keyA, { title: "viewer issue" }));
    await denied(issueActions.updateIssue(w.keyA, w.A.issue.id, { title: "viewer edit" }));
    await denied(issueActions.deleteIssue(w.keyA, w.A.issue.id));
    expect((await prisma.issue.findUnique({ where: { id: w.A.issue.id } }))?.title).toBe(`${w.keyA} secret issue`);
  });

  it("a VIEWER cannot create or delete issue links or doc links (SECH-96)", async () => {
    // Throwaway pair so the test doesn't depend on links other tests left behind.
    const [src, dst] = await Promise.all([91, 92].map((n) =>
      prisma.issue.create({
        data: { key: `${w.keyA}-${n}`, projectId: w.A.project.id, title: `link ${n}`, statusId: w.A.statuses.todo.id, reporterId: w.users.aOwner.id, position: n },
      })
    ));
    try {
      const existing = await prisma.issueLink.create({
        data: { sourceIssueId: src.id, targetIssueId: dst.id, linkType: "RELATES_TO", createdById: w.users.aOwner.id },
      });
      await prisma.issueDocLink.create({ data: { issueId: src.id, pageId: w.A.page.id, createdById: w.users.aOwner.id } });

      actAs(w.users.aViewer);
      await denied(issueActions.linkIssue(w.keyA, dst.id, src.id, "BLOCKS"));
      await denied(issueActions.unlinkIssue(w.keyA, existing.id));
      await denied(issueActions.linkDocPage(w.keyA, dst.id, w.A.page.id));
      await denied(issueActions.unlinkDocPage(w.keyA, src.id, w.A.page.id));

      const ids = [src.id, dst.id];
      expect(await prisma.issueLink.count({ where: { sourceIssueId: { in: ids } } })).toBe(1);
      expect(await prisma.issueDocLink.count({ where: { issueId: { in: ids } } })).toBe(1);
    } finally {
      await prisma.issue.deleteMany({ where: { id: { in: [src.id, dst.id] } } });
    }
  });

  it("a TEAM_MEMBER cannot manage the project, its members, or its board", async () => {
    actAs(w.users.aMember);
    await denied(issueActions.updateProject(w.keyA, { name: "pwn" }));
    await denied(issueActions.deleteProject(w.keyA));
    await denied(issueActions.addProjectMember(w.keyA, w.users.aViewer.id, "PROJECT_LEAD"));
    await denied(issueActions.changeMemberRole(w.keyA, w.A.memberships[w.users.aViewer.id].id, "PROJECT_LEAD"));
    await denied(boardActions.createProjectStatus(w.keyA, { name: "pwn", category: "TODO" }));
    await denied(sprintActions.createSprint(w.keyA, { name: "pwn" }));
    expect((await prisma.project.findUnique({ where: { id: w.A.project.id } }))?.name).toBe(`Itest ${w.keyA}`);
  });

  it("an org MEMBER cannot manage API keys, groups or custom fields", async () => {
    actAs(w.users.aMember);
    await denied(apiKeyActions.createApiKey(w.orgA.id, "pwn"));
    await denied(apiKeyActions.revokeApiKey(w.orgA.id, w.apiKeyA.id));
    await denied(groupActions.createGroup(w.orgA.id, "pwn"));
    await denied(fieldActions.createCustomField(w.orgA.id, { name: "pwn", type: "TEXT" }, w.keyA));
    expect((await prisma.apiKey.findUnique({ where: { id: w.apiKeyA.id } }))?.revokedAt).toBeNull();
  });

  it("platform-admin-only actions reject an org OWNER who is not a platform ADMIN", async () => {
    actAs(w.users.aOwner);
    await denied(adminActions.getAdminUsers());
    await denied(adminActions.adminDeleteOrg(w.orgB.id));
    await denied(adminActions.closeProject(w.B.project.id));
    await denied(adminActions.adminDeleteProject(w.B.project.id));
    await denied(issueActions.setProjectPrivacy(w.keyA, true));
    const fd = new FormData();
    fd.set("projectId", w.A.project.id);
    await denied(closedActions.reopenProject(fd));
    expect(await prisma.organization.count({ where: { id: w.orgB.id } })).toBe(1);
  });
});

describe("stale membership and missing sessions fail closed", () => {
  it("removing a project membership immediately cuts access", async () => {
    actAs(w.users.bMember);
    await expect(issueActions.getIssues(w.keyB)).resolves.toBeDefined();
    await prisma.projectMember.deleteMany({ where: { userId: w.users.bMember.id, projectId: w.B.project.id } });
    try {
      await denied(issueActions.getIssues(w.keyB));
      await denied(issueActions.createIssue(w.keyB, { title: "stale" }));
      await denied(issueActions.addComment(w.keyB, w.B.issue.id, "stale"));
    } finally {
      await prisma.projectMember.create({ data: { userId: w.users.bMember.id, projectId: w.B.project.id, role: "TEAM_MEMBER" } });
    }
  });

  it("removing an org membership immediately cuts org-level access", async () => {
    actAs(w.users.bOwner);
    await expect(apiKeyActions.listApiKeys(w.orgB.id)).resolves.toBeDefined();
    await prisma.orgMember.deleteMany({ where: { orgId: w.orgB.id, userId: w.users.bOwner.id } });
    try {
      await denied(apiKeyActions.listApiKeys(w.orgB.id));
      await denied(apiKeyActions.createApiKey(w.orgB.id, "stale"));
    } finally {
      await prisma.orgMember.create({ data: { orgId: w.orgB.id, userId: w.users.bOwner.id, role: "OWNER" } });
    }
  });

  it("no session (or an invalidated one, which auth() maps to null) rejects everything", async () => {
    actAsNobody();
    await denied(issueActions.getIssues(w.keyB));
    await denied(issueActions.createIssue(w.keyB, { title: "anon" }));
    await denied(apiKeyActions.listApiKeys(w.orgB.id));
    await denied(groupActions.createGroup(w.orgB.id, "anon"));
    await denied(adminActions.getAdminUsers());
    await denied(filterActions.getMyFilters(w.B.project.id));
  });
});

describe("platform admin actions", () => {
  it("adminDeleteUser refuses (with a message, not an FK crash) while the user has created org API keys", async () => {
    const creator = await prisma.user.create({ data: { name: "key creator", email: `${w.tag}-keymaker@itest.local`, passwordHash: "x" } });
    const admin = await prisma.user.create({ data: { name: "root", email: `${w.tag}-root@itest.local`, passwordHash: "x", role: "ADMIN" } });
    try {
      await prisma.orgMember.create({ data: { orgId: w.orgB.id, userId: creator.id, role: "ADMIN" } });
      await prisma.apiKey.create({ data: { orgId: w.orgB.id, name: "k", keyPrefix: "itestkey", hashedKey: `itest-${w.tag}-hash`, createdById: creator.id } });
      actAs({ id: admin.id, name: admin.name, email: admin.email, role: "ADMIN", orgId: w.orgB.id });
      const result = await adminActions.adminDeleteUser(creator.id);
      expect(result).toMatchObject({ success: false });
      expect((result as { error: string }).error).toMatch(/api key/i);
      expect(await prisma.user.count({ where: { id: creator.id } })).toBe(1);
    } finally {
      await prisma.apiKey.deleteMany({ where: { createdById: creator.id } });
      await prisma.orgMember.deleteMany({ where: { userId: creator.id } });
      await prisma.user.deleteMany({ where: { id: { in: [creator.id, admin.id] } } });
    }
  });
});

// Regression tests for the mass-assignment / unscoped-id defects found by the SECH-85 audit.
describe("SECH-85 regressions: a legitimate editor cannot escape their project", () => {
  beforeEach(() => actAs(w.users.bMember));

  it("updateIssue ignores fields outside the editable set (no moving an issue to another project)", async () => {
    const issue = await prisma.issue.create({
      data: { key: `${w.keyB}-90`, projectId: w.B.project.id, title: "mine", statusId: w.B.statuses.todo.id, reporterId: w.users.bOwner.id, position: 90 },
    });
    await issueActions.updateIssue(w.keyB, issue.id, {
      title: "renamed",
      projectId: w.A.project.id,
      reporterId: w.users.aOwner.id,
      parentId: w.A.issue.id,
      key: `${w.keyA}-999`,
    } as never);
    const after = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(after.title).toBe("renamed");
    expect(after.projectId).toBe(w.B.project.id);
    expect(after.reporterId).toBe(w.users.bOwner.id);
    expect(after.parentId).toBeNull();
    expect(after.key).toBe(`${w.keyB}-90`);
  });

  it("updateIssue / createIssue / moveIssue reject a status that belongs to another project", async () => {
    await expect(issueActions.updateIssue(w.keyB, w.B.issue.id, { statusId: w.A.statuses.done.id })).rejects.toThrow(/invalid status/i);
    await expect(issueActions.createIssue(w.keyB, { title: "x", statusId: w.A.statuses.done.id })).rejects.toThrow(/invalid status/i);
    await expect(issueActions.moveIssue(w.keyB, w.B.issue.id, w.A.statuses.done.id, 0)).rejects.toThrow(/failed to move/i);
    expect((await prisma.issue.findUniqueOrThrow({ where: { id: w.B.issue.id } })).statusId).toBe(w.B.statuses.todo.id);
  });

  it("createIssue rejects a parent issue from another project", async () => {
    await expect(issueActions.createIssue(w.keyB, { title: "x", parentId: w.A.issue.id })).rejects.toThrow(/parent issue not found/i);
  });

  it("updateProject only changes name/description — never orgId, privacy, closed state or key", async () => {
    actAs(w.users.bOwner); // PROJECT_LEAD
    await issueActions.updateProject(w.keyB, {
      name: "Renamed B",
      orgId: w.orgA.id,
      isPrivate: true,
      isClosed: true,
      key: "HIJACK",
      workflowMode: "SPRINT",
    } as never);
    const after = await prisma.project.findUniqueOrThrow({ where: { id: w.B.project.id } });
    expect(after.name).toBe("Renamed B");
    expect(after.orgId).toBe(w.orgB.id);
    expect(after.isPrivate).toBe(false);
    expect(after.isClosed).toBe(false);
    expect(after.key).toBe(w.keyB);
    expect(after.workflowMode).toBe("KANBAN");
  });

  it("updateFilter cannot reassign a filter to another user or project", async () => {
    const filter = await prisma.savedFilter.create({
      data: { name: "mine", query: "status = Done", userId: w.users.bMember.id, projectId: w.B.project.id },
    });
    await filterActions.updateFilter(filter.id, { name: "renamed", userId: w.users.aOwner.id, projectId: w.A.project.id } as never);
    const after = await prisma.savedFilter.findUniqueOrThrow({ where: { id: filter.id } });
    expect(after.name).toBe("renamed");
    expect(after.userId).toBe(w.users.bMember.id);
    expect(after.projectId).toBe(w.B.project.id);
  });

  it("a non-admin cannot make a filter global", async () => {
    const filter = await prisma.savedFilter.create({
      data: { name: "mine2", query: "q", userId: w.users.bMember.id, projectId: w.B.project.id },
    });
    await expect(filterActions.updateFilter(filter.id, { isGlobal: true })).rejects.toThrow(/forbidden/i);
  });

  it("searchOrgMembersForGroup returns nothing for a group of another org", async () => {
    actAs(w.users.bOwner);
    expect(await groupActions.searchOrgMembersForGroup(w.orgB.id, w.groupA.id, "")).toEqual([]);
  });
});

// SECH-93: the external API and MCP already filter isClosed:false; the session-authenticated
// actions did not. Docs are covered separately in cross-tenant-routes.itest.ts — they stay
// readable on a closed project (closed-project invariant #3), only writes are blocked.
describe("SECH-93: closed projects write-lock session actions (platform admin bypasses)", () => {
  it("rejects issue/comment/project writes from a project member while closed, but not from an admin", async () => {
    await prisma.project.update({ where: { id: w.A.project.id }, data: { isClosed: true } });
    try {
      actAs(w.users.aMember); // TEAM_MEMBER of A
      await denied(issueActions.createIssue(w.keyA, { title: "pwn" }));
      await denied(issueActions.updateIssue(w.keyA, w.A.issue.id, { title: "pwn" }));
      await denied(issueActions.moveIssue(w.keyA, w.A.issue.id, w.A.statuses.done.id, 0));
      await denied(issueActions.addComment(w.keyA, w.A.issue.id, "<p>pwn</p>"));

      actAs(w.users.aOwner); // PROJECT_LEAD of A
      await denied(issueActions.updateProject(w.keyA, { name: "pwn" }));
      await denied(issueActions.deleteIssue(w.keyA, w.A.issue2.id));

      // Reads still work while closed — only writes are locked.
      actAs(w.users.aMember);
      expect((await issueActions.getIssue(w.keyA, w.A.issue.key))?.title).toBe(`${w.keyA} secret issue`);

      // Platform admin bypasses the write-lock, mirroring the closed-project UI gate.
      actAs(w.users.aAdmin);
      const created = await issueActions.createIssue(w.keyA, { title: "admin edit while closed" });
      expect(created.issue.title).toBe("admin edit while closed");
      await prisma.issue.delete({ where: { id: created.issue.id } });

      const issue = await prisma.issue.findUniqueOrThrow({ where: { id: w.A.issue.id } });
      expect(issue.title).toBe(`${w.keyA} secret issue`);
    } finally {
      await prisma.project.update({ where: { id: w.A.project.id }, data: { isClosed: false } });
    }
  });
});
