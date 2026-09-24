import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn() },
    adminAuditLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { logAdminAction } from "@/lib/audit-log";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mockPrisma.user.findUnique.mockResolvedValue({ name: "Alice", email: "admin@jedforge.dev" });
  mockPrisma.adminAuditLog.create.mockResolvedValue({});
});
afterEach(() => warn.mockRestore());

const action = () =>
  logAdminAction({
    actorId: "u1",
    action: "ROLE_CHANGED",
    targetType: "User",
    targetId: "u2",
    targetLabel: "Bob",
  });

describe("logAdminAction bridge (SECH-114)", () => {
  it("still writes the durable audit row", async () => {
    await action();
    expect(mockPrisma.adminAuditLog.create).toHaveBeenCalled();
  });

  it("also emits exactly one admin.action security event", async () => {
    await action();

    expect(warn).toHaveBeenCalledTimes(1);
    const rec = JSON.parse(warn.mock.calls[0][0] as string);
    expect(rec.type).toBe("admin.action");
    expect(rec.severity).toBe("info");
    expect(rec.userId).toBe("u1");
    expect(rec.meta.action).toBe("ROLE_CHANGED");
    expect(rec.meta.targetType).toBe("User");
    expect(rec.meta.targetId).toBe("u2");
  });

  // The DB row already carries actor name and email for the admin UI. The stream
  // carries the id alone, so a log destination never becomes a second PII sink.
  it("does not put the actor's email or name in the event", async () => {
    await action();
    const line = warn.mock.calls[0][0] as string;
    expect(line).not.toContain("admin@jedforge.dev");
    expect(line).not.toContain("Alice");
  });
});
