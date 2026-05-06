import { describe, it, expect, vi } from "vitest";

// permissions.ts imports auth and prisma (used only in requireProjectRole, not the pure helpers)
// — mock them to prevent transitive next/server resolution errors in the test runner.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import {
  canManageProject,
  canEditSettings,
  canManageMembers,
  canEditIssues,
  canViewProject,
  canComment,
} from "@/lib/permissions";
import type { ProjectRole } from "@/lib/permissions";

const ALL_ROLES: ProjectRole[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];

describe("canManageProject — OWNER only", () => {
  it("allows OWNER", () => expect(canManageProject("OWNER")).toBe(true));
  it("denies ADMIN", () => expect(canManageProject("ADMIN")).toBe(false));
  it("denies MEMBER", () => expect(canManageProject("MEMBER")).toBe(false));
  it("denies VIEWER", () => expect(canManageProject("VIEWER")).toBe(false));
});

describe("canEditSettings — OWNER and ADMIN", () => {
  it("allows OWNER", () => expect(canEditSettings("OWNER")).toBe(true));
  it("allows ADMIN", () => expect(canEditSettings("ADMIN")).toBe(true));
  it("denies MEMBER", () => expect(canEditSettings("MEMBER")).toBe(false));
  it("denies VIEWER", () => expect(canEditSettings("VIEWER")).toBe(false));
});

describe("canManageMembers — OWNER and ADMIN", () => {
  it("allows OWNER", () => expect(canManageMembers("OWNER")).toBe(true));
  it("allows ADMIN", () => expect(canManageMembers("ADMIN")).toBe(true));
  it("denies MEMBER", () => expect(canManageMembers("MEMBER")).toBe(false));
  it("denies VIEWER", () => expect(canManageMembers("VIEWER")).toBe(false));
});

describe("canEditIssues — OWNER, ADMIN, and MEMBER", () => {
  it("allows OWNER", () => expect(canEditIssues("OWNER")).toBe(true));
  it("allows ADMIN", () => expect(canEditIssues("ADMIN")).toBe(true));
  it("allows MEMBER", () => expect(canEditIssues("MEMBER")).toBe(true));
  it("denies VIEWER", () => expect(canEditIssues("VIEWER")).toBe(false));
});

describe("canViewProject — all roles", () => {
  it.each(ALL_ROLES)("allows %s", (role) => expect(canViewProject(role)).toBe(true));
});

describe("canComment — all roles", () => {
  it.each(ALL_ROLES)("allows %s", (role) => expect(canComment(role)).toBe(true));
});

describe("role hierarchy consistency", () => {
  it("OWNER can do everything ADMIN can", () => {
    const checks = [canEditSettings, canManageMembers, canEditIssues, canViewProject, canComment];
    for (const check of checks) {
      expect(check("OWNER")).toBe(check("ADMIN") || true);
    }
  });

  it("VIEWER cannot edit issues, settings, or members", () => {
    expect(canEditIssues("VIEWER")).toBe(false);
    expect(canEditSettings("VIEWER")).toBe(false);
    expect(canManageMembers("VIEWER")).toBe(false);
    expect(canManageProject("VIEWER")).toBe(false);
  });
});
