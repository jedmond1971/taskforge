import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs, actAsNobody, type TestUser } from "./session";
import * as adminActions from "@/app/(dashboard)/admin/actions";
import * as closedActions from "@/app/(dashboard)/projects/closed-actions";
import * as issueActions from "@/app/(dashboard)/projects/[projectKey]/actions";

/**
 * SECH-97: every platform-admin action, row by row from authz-matrix.md. Platform ADMIN is
 * cross-tenant by design, so the boundary under test is the role itself: an org OWNER (the
 * strongest non-admin), a plain member, and an anonymous caller must all be refused by every
 * action, with the victim's data unchanged. The tenancy invariants the admin overrides must
 * still respect (6, 7, 8 in CLAUDE.md) are checked with a real ADMIN.
 */

let w: World;
let invite: { id: string };
beforeAll(async () => {
  w = await createWorld();
  invite = await prisma.orgInvite.create({
    data: { orgId: w.orgA.id, email: `${w.tag}-pending@itest.local`, invitedById: w.users.aOwner.id, expiresAt: new Date(Date.now() + 86_400_000) },
  });
});
afterAll(async () => { await destroyWorld(w); });

const DENIED = /unauthorized|forbidden/i;

// Everything an admin action could change, across both orgs.
async function snapshot() {
  const userIds = Object.values(w.users).map((u) => u.id);
  const orgIds = [w.orgA.id, w.orgB.id];
  const [users, orgs, orgMembers, projects, projectMembers, invites, audit, userCount, orgCount, tokens, keys] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, orderBy: { id: "asc" }, select: { id: true, name: true, email: true, role: true, passwordHash: true, sessionVersion: true } }),
    prisma.organization.findMany({ where: { id: { in: orgIds } }, orderBy: { id: "asc" }, select: { id: true, name: true, slug: true, ownerId: true } }),
    prisma.orgMember.findMany({ where: { orgId: { in: orgIds } }, orderBy: { id: "asc" }, select: { orgId: true, userId: true, role: true } }),
    prisma.project.findMany({ where: { orgId: { in: orgIds } }, orderBy: { id: "asc" }, select: { id: true, isClosed: true, isPrivate: true, orgId: true } }),
    prisma.projectMember.findMany({ where: { project: { orgId: { in: orgIds } } }, orderBy: { id: "asc" }, select: { userId: true, projectId: true, role: true } }),
    prisma.orgInvite.findMany({ where: { orgId: { in: orgIds } }, orderBy: { id: "asc" }, select: { id: true, email: true, accepted: true, expiresAt: true, token: true } }),
    prisma.adminAuditLog.count(),
    prisma.user.count(),
    prisma.organization.count(),
    prisma.oAuthAccessToken.count({ where: { revokedAt: null, orgId: { in: orgIds } } }),
    prisma.apiKey.count({ where: { revokedAt: null, orgId: { in: orgIds } } }),
  ]);
  return { users, orgs, orgMembers, projects, projectMembers, invites, audit, userCount, orgCount, tokens, keys };
}

// One call per exported admin action (authz-matrix.md → "(dashboard)/admin/actions.ts"), each
// aimed at Org A with arguments that WOULD succeed for a platform admin.
function everyAdminAction(): Array<[string, () => Promise<unknown>]> {
  const a = w.A, u = w.users;
  return [
    ["getAdminUsers", () => adminActions.getAdminUsers()],
    ["adminCreateUser", () => adminActions.adminCreateUser({ name: "x", email: `${w.tag}-made@itest.local`, password: "password123", role: "ADMIN" })],
    ["adminUpdateUser", () => adminActions.adminUpdateUser(u.aMember.id, { role: "ADMIN" })],
    ["adminResetUserPassword", () => adminActions.adminResetUserPassword(u.aOwner.id, "hijacked123")],
    ["adminAddUserToProject", () => adminActions.adminAddUserToProject(u.bMember.id, a.project.id, "PROJECT_LEAD")],
    ["adminGetProjectsForSelect", () => adminActions.adminGetProjectsForSelect()],
    ["adminDeleteUser", () => adminActions.adminDeleteUser(u.aViewer.id)],
    ["getAdminProjects", () => adminActions.getAdminProjects()],
    ["getAdminProjectDetail", () => adminActions.getAdminProjectDetail(a.project.id)],
    ["getAdminOrgs", () => adminActions.getAdminOrgs()],
    ["getAdminOrgMembers", () => adminActions.getAdminOrgMembers(w.orgA.id)],
    ["getAdminOrgDetail", () => adminActions.getAdminOrgDetail(w.orgA.id)],
    ["adminCreateOrg", () => adminActions.adminCreateOrg({ name: "x", slug: `itest-x-${w.tag}`, plan: "FREE", ownerId: u.bMember.id })],
    ["adminAddOrgMember", () => adminActions.adminAddOrgMember(w.orgA.id, u.bMember.id, "OWNER")],
    ["adminRemoveOrgMember", () => adminActions.adminRemoveOrgMember(w.orgA.id, u.aMember.id)],
    ["adminDeleteOrg", () => adminActions.adminDeleteOrg(w.orgA.id)],
    ["adminDeleteProject", () => adminActions.adminDeleteProject(a.project.id)],
    ["closeProject", () => adminActions.closeProject(a.project.id)],
    ["reopenProject", () => adminActions.reopenProject(a.project.id)],
    ["getAdminInvites", () => adminActions.getAdminInvites()],
    ["adminGetOrgsForSelect", () => adminActions.adminGetOrgsForSelect()],
    ["adminCreateInvite", () => adminActions.adminCreateInvite(w.orgA.id, `${w.tag}-new@itest.local`, "ADMIN")],
    ["adminResendInvite", () => adminActions.adminResendInvite(invite.id)],
    ["adminRevokeInvite", () => adminActions.adminRevokeInvite(invite.id)],
    ["getAdminAuditLog", () => adminActions.getAdminAuditLog()],
  ];
}

describe("every platform-admin action refuses non-admins", () => {
  it("the matrix covers every exported admin action", async () => {
    const exported = Object.entries(adminActions).filter(([, v]) => typeof v === "function").map(([k]) => k).sort();
    expect(everyAdminAction().map(([name]) => name).sort()).toEqual(exported);
  });

  const cases: Array<[string, () => TestUser | null]> = [
    ["an org OWNER of the target org", () => w.users.aOwner],
    ["an org OWNER of another org", () => w.users.bOwner],
    ["a plain project member", () => w.users.aMember],
    ["no session", () => null],
  ];
  for (const [label, who] of cases) {
    it(`${label}: all denied, nothing changed`, async () => {
      const user = who();
      if (user) actAs(user); else actAsNobody();
      const before = await snapshot();
      for (const [name, attempt] of everyAdminAction()) {
        await expect(attempt(), name).rejects.toThrow(DENIED);
      }
      // The two admin-only actions that live outside admin/actions.ts.
      await expect(issueActions.setProjectPrivacy(w.keyA, true), "setProjectPrivacy").rejects.toThrow(DENIED);
      const fd = new FormData();
      fd.set("projectId", w.A.project.id);
      await expect(closedActions.reopenProject(fd), "closed-actions reopenProject").rejects.toThrow(DENIED);

      expect(await snapshot()).toEqual(before);
    });
  }

  it("a session whose role is no longer ADMIN is refused even for a user who was once an admin", async () => {
    // requireAdmin reads the session role; a demotion bumps sessionVersion, which auth() turns
    // into a null session (SECH-86) — the "no session" case above.
    actAs({ ...w.users.aAdmin, role: "TEAM_MEMBER" });
    await expect(adminActions.getAdminUsers()).rejects.toThrow(DENIED);
  });
});

describe("admin overrides still respect the tenancy invariants", () => {
  it("control: a platform ADMIN can read across tenants", async () => {
    actAs(w.users.aAdmin);
    const orgs = await adminActions.getAdminOrgMembers(w.orgB.id);
    expect(orgs.map((m) => m.user.id).sort()).toEqual([w.users.bOwner.id, w.users.bMember.id].sort());
  });

  it("invariant 8: adminAddUserToProject upserts the OrgMember before the ProjectMember", async () => {
    actAs(w.users.aAdmin);
    try {
      expect(await adminActions.adminAddUserToProject(w.users.bMember.id, w.A.project.id, "VIEWER")).toEqual({ success: true });
      expect(await prisma.orgMember.findUnique({ where: { orgId_userId: { orgId: w.orgA.id, userId: w.users.bMember.id } }, select: { role: true } })).toEqual({ role: "MEMBER" });
      expect(await prisma.projectMember.findUnique({ where: { userId_projectId: { userId: w.users.bMember.id, projectId: w.A.project.id } }, select: { role: true } })).toEqual({ role: "VIEWER" });
      // Adding them again is refused, not duplicated.
      expect(await adminActions.adminAddUserToProject(w.users.bMember.id, w.A.project.id, "PROJECT_LEAD")).toMatchObject({ success: false });
    } finally {
      await prisma.projectMember.deleteMany({ where: { userId: w.users.bMember.id, projectId: w.A.project.id } });
      await prisma.orgMember.deleteMany({ where: { userId: w.users.bMember.id, orgId: w.orgA.id } });
    }
  });

  it("invariant 7: adminRemoveOrgMember refuses while the user still has projects in that org (no cascade, no revocation)", async () => {
    actAs(w.users.aAdmin);
    const before = await snapshot();
    expect(await adminActions.adminRemoveOrgMember(w.orgA.id, w.users.aMember.id)).toMatchObject({ success: false, error: expect.stringMatching(/still belong/i) });
    expect(await adminActions.adminRemoveOrgMember(w.orgA.id, w.users.aOwner.id)).toMatchObject({ success: false, error: expect.stringMatching(/owner/i) });
    expect(await snapshot()).toEqual(before);
  });

  it("invariant 6: adminDeleteOrg refuses while the org has projects", async () => {
    actAs(w.users.aAdmin);
    const before = await snapshot();
    expect(await adminActions.adminDeleteOrg(w.orgA.id)).toMatchObject({ success: false, error: expect.stringMatching(/project/i) });
    expect(await snapshot()).toEqual(before);
  });

  it("control: close/reopen by a platform ADMIN only touches the named project", async () => {
    actAs(w.users.aAdmin);
    try {
      await adminActions.closeProject(w.A.project.id);
      const projects = await prisma.project.findMany({ where: { id: { in: [w.A.project.id, w.B.project.id] } }, select: { id: true, isClosed: true } });
      expect(Object.fromEntries(projects.map((p) => [p.id, p.isClosed]))).toEqual({ [w.A.project.id]: true, [w.B.project.id]: false });
    } finally {
      await adminActions.reopenProject(w.A.project.id);
    }
    expect((await prisma.project.findUniqueOrThrow({ where: { id: w.A.project.id } })).isClosed).toBe(false);
  });
});
