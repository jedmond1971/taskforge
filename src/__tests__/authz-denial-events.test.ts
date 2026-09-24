import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAuth, mockPrisma, mockSecurityEvents } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockPrisma: {
    project: { findUnique: vi.fn() },
    projectMember: { findUnique: vi.fn() },
    groupPermission: { findMany: vi.fn() },
  },
  mockSecurityEvents: { securityEvent: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/security-events", () => mockSecurityEvents);

import { requireProjectRole, canEditIssues, canManageProject } from "@/lib/permissions";

const USER = { id: "u1", role: "USER" };
const PROJECT = { id: "p1", key: "PL", orgId: "o1", isPrivate: false, isClosed: false };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: USER });
  mockPrisma.project.findUnique.mockResolvedValue(PROJECT);
  mockPrisma.projectMember.findUnique.mockResolvedValue({ role: "TEAM_MEMBER" });
  mockPrisma.groupPermission.findMany.mockResolvedValue([]);
});

describe("authorization-denial events (SECH-114)", () => {
  it("emits a tenancy event when the caller is not a project member", async () => {
    mockPrisma.projectMember.findUnique.mockResolvedValue(null);

    await expect(requireProjectRole("PL", canEditIssues)).rejects.toThrow("Not a project member");
    expect(mockSecurityEvents.securityEvent).toHaveBeenCalledWith(
      "authz.denied_not_member",
      expect.objectContaining({ userId: "u1", orgId: "o1" })
    );
  });

  it("emits a tenancy event for a private project the caller cannot see", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ ...PROJECT, isPrivate: true });
    mockPrisma.projectMember.findUnique.mockResolvedValue(null);

    await expect(requireProjectRole("PL", canEditIssues)).rejects.toThrow(
      "You do not have access to this project."
    );
    expect(mockSecurityEvents.securityEvent).toHaveBeenCalledWith(
      "authz.denied_private_project",
      expect.objectContaining({ userId: "u1", orgId: "o1" })
    );
  });

  it("emits a role event when the member's role is too low", async () => {
    await expect(requireProjectRole("PL", canManageProject)).rejects.toThrow("Forbidden");
    expect(mockSecurityEvents.securityEvent).toHaveBeenCalledWith(
      "authz.denied_role",
      expect.objectContaining({ userId: "u1", orgId: "o1" })
    );
  });

  it("emits nothing at all on the allowed path", async () => {
    await expect(requireProjectRole("PL", canEditIssues)).resolves.toMatchObject({ userId: "u1" });
    expect(mockSecurityEvents.securityEvent).not.toHaveBeenCalled();
  });

  // Spec section 3: these are normal application flow, not security events. Emitting
  // them is what would create the volume problem that sampling exists to solve.
  it("emits nothing for an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(requireProjectRole("PL", canEditIssues)).rejects.toThrow("Unauthorized");
    expect(mockSecurityEvents.securityEvent).not.toHaveBeenCalled();
  });

  it("emits nothing when the project is merely closed", async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ ...PROJECT, isClosed: true });

    await expect(requireProjectRole("PL", canEditIssues)).rejects.toThrow("This project is closed");
    expect(mockSecurityEvents.securityEvent).not.toHaveBeenCalled();
  });

  it("emits nothing when the project does not exist", async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);

    await expect(requireProjectRole("PL", canEditIssues)).rejects.toThrow("Project not found");
    expect(mockSecurityEvents.securityEvent).not.toHaveBeenCalled();
  });
});
