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

const ALL_ROLES: ProjectRole[] = ["PROJECT_LEAD", "TEAM_MEMBER", "VIEWER"];

describe("canManageProject — PROJECT_LEAD only", () => {
  it("allows PROJECT_LEAD", () => expect(canManageProject("PROJECT_LEAD")).toBe(true));
  it("denies TEAM_MEMBER", () => expect(canManageProject("TEAM_MEMBER")).toBe(false));
  it("denies VIEWER", () => expect(canManageProject("VIEWER")).toBe(false));
});

describe("canEditSettings — PROJECT_LEAD only", () => {
  it("allows PROJECT_LEAD", () => expect(canEditSettings("PROJECT_LEAD")).toBe(true));
  it("denies TEAM_MEMBER", () => expect(canEditSettings("TEAM_MEMBER")).toBe(false));
  it("denies VIEWER", () => expect(canEditSettings("VIEWER")).toBe(false));
});

describe("canManageMembers — PROJECT_LEAD only", () => {
  it("allows PROJECT_LEAD", () => expect(canManageMembers("PROJECT_LEAD")).toBe(true));
  it("denies TEAM_MEMBER", () => expect(canManageMembers("TEAM_MEMBER")).toBe(false));
  it("denies VIEWER", () => expect(canManageMembers("VIEWER")).toBe(false));
});

describe("canEditIssues — PROJECT_LEAD and TEAM_MEMBER", () => {
  it("allows PROJECT_LEAD", () => expect(canEditIssues("PROJECT_LEAD")).toBe(true));
  it("allows TEAM_MEMBER", () => expect(canEditIssues("TEAM_MEMBER")).toBe(true));
  it("denies VIEWER", () => expect(canEditIssues("VIEWER")).toBe(false));
});

describe("canViewProject — all roles", () => {
  it.each(ALL_ROLES)("allows %s", (role) => expect(canViewProject(role)).toBe(true));
});

describe("canComment — all roles", () => {
  it.each(ALL_ROLES)("allows %s", (role) => expect(canComment(role)).toBe(true));
});

describe("role hierarchy consistency", () => {
  it("PROJECT_LEAD can do everything TEAM_MEMBER can", () => {
    const checks = [canEditSettings, canManageMembers, canEditIssues, canViewProject, canComment];
    for (const check of checks) {
      expect(check("PROJECT_LEAD")).toBe(check("TEAM_MEMBER") || true);
    }
  });

  it("VIEWER cannot edit issues, settings, or members", () => {
    expect(canEditIssues("VIEWER")).toBe(false);
    expect(canEditSettings("VIEWER")).toBe(false);
    expect(canManageMembers("VIEWER")).toBe(false);
    expect(canManageProject("VIEWER")).toBe(false);
  });
});
