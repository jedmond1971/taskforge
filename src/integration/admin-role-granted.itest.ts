import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createWorld, destroyWorld, type World } from "./fixtures";
import { actAs } from "./session";
import * as adminActions from "@/app/(dashboard)/admin/actions";

/**
 * SECH-117: granting the platform ADMIN role is a critical event. Before this, a grant only
 * appeared as the generic admin.action, so no alert rule could match it specifically.
 */

let w: World;
beforeAll(async () => { w = await createWorld(); });
afterAll(async () => { await destroyWorld(w); });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });

function events(type: string): Array<Record<string, unknown>> {
  return warn.mock.calls
    .map(([line]) => { try { return JSON.parse(String(line)); } catch { return null; } })
    .filter((r): r is Record<string, unknown> => !!r && r.evt === "security" && r.type === type);
}

describe("admin.role_granted", () => {
  it("adminUpdateUser to ADMIN emits it with the actor and the grantee kept apart", async () => {
    actAs(w.users.aAdmin);
    const prior = (await prisma.user.findUnique({ where: { id: w.users.aMember.id }, select: { role: true } }))!.role;
    try {
      expect(await adminActions.adminUpdateUser(w.users.aMember.id, { role: "ADMIN" })).toMatchObject({ success: true });
      const [evt] = events("admin.role_granted");
      expect(evt).toMatchObject({
        severity: "critical",
        userId: w.users.aAdmin.id,
        targetUserId: w.users.aMember.id,
        meta: { from: prior, to: "ADMIN", trigger: "admin_update_user" },
      });
      expect(events("admin.role_granted")).toHaveLength(1);
    } finally {
      await prisma.user.update({ where: { id: w.users.aMember.id }, data: { role: prior } });
    }
  });

  it("emits nothing when the role does not change or is not ADMIN", async () => {
    actAs(w.users.aAdmin);
    await adminActions.adminUpdateUser(w.users.aAdmin.id, { role: "ADMIN" }); // already ADMIN
    await adminActions.adminUpdateUser(w.users.aMember.id, { name: "Renamed" }); // no role in update
    expect(events("admin.role_granted")).toHaveLength(0);
  });

  it("adminCreateUser emits it only when the new user is an ADMIN", async () => {
    actAs(w.users.aAdmin);
    const adminEmail = `${w.tag}-newadmin@itest.local`;
    const plainEmail = `${w.tag}-newplain@itest.local`;
    try {
      await adminActions.adminCreateUser({ name: "x", email: plainEmail, password: "password123", role: "TEAM_MEMBER" });
      expect(events("admin.role_granted")).toHaveLength(0);

      await adminActions.adminCreateUser({ name: "x", email: adminEmail, password: "password123", role: "ADMIN" });
      const created = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } });
      const [evt] = events("admin.role_granted");
      expect(evt).toMatchObject({
        userId: w.users.aAdmin.id,
        targetUserId: created!.id,
        meta: { to: "ADMIN", trigger: "admin_create_user" },
      });
    } finally {
      await prisma.user.deleteMany({ where: { email: { in: [adminEmail, plainEmail] } } });
    }
  });
});
