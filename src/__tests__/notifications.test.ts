import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate, mockCreateMany } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockCreateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      create: mockCreate,
      createMany: mockCreateMany,
    },
  },
}));

import { notificationService } from "@/lib/notifications";

describe("notificationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockResolvedValue({});
    mockCreateMany.mockResolvedValue({ count: 0 });
  });

  describe("issueAssigned", () => {
    it("does not throw when called with valid params", async () => {
      await expect(
        notificationService.issueAssigned({
          assigneeId: "user-2",
          issueKey: "TF-1",
          issueTitle: "Test Issue",
          issueId: "issue-1",
          actorId: "user-1",
        })
      ).resolves.not.toThrow();
    });

    it("skips notification when assigneeId equals actorId", async () => {
      await notificationService.issueAssigned({
        assigneeId: "user-1",
        issueKey: "TF-1",
        issueTitle: "Test Issue",
        issueId: "issue-1",
        actorId: "user-1",
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("creates notification when assigneeId differs from actorId", async () => {
      await notificationService.issueAssigned({
        assigneeId: "user-2",
        issueKey: "TF-1",
        issueTitle: "Test Issue",
        issueId: "issue-1",
        actorId: "user-1",
      });
      expect(mockCreate).toHaveBeenCalledOnce();
    });
  });

  describe("commentAdded (createNotifications)", () => {
    it("does not create notifications when userId is null/undefined", async () => {
      await notificationService.commentAdded({
        issueKey: "TF-1",
        issueTitle: "Test Issue",
        issueId: "issue-1",
        assigneeId: null,
        reporterId: undefined,
        actorId: "user-1",
      });
      expect(mockCreateMany).not.toHaveBeenCalled();
    });

    it("deduplicates when assigneeId equals reporterId", async () => {
      await notificationService.commentAdded({
        issueKey: "TF-1",
        issueTitle: "Test Issue",
        issueId: "issue-1",
        assigneeId: "user-2",
        reporterId: "user-2",
        actorId: "user-1",
      });
      expect(mockCreateMany).toHaveBeenCalledOnce();
      const call = mockCreateMany.mock.calls[0][0];
      expect(call.data).toHaveLength(1);
      expect(call.data[0].userId).toBe("user-2");
    });

    it("creates two notifications when assigneeId and reporterId are different", async () => {
      await notificationService.commentAdded({
        issueKey: "TF-1",
        issueTitle: "Test Issue",
        issueId: "issue-1",
        assigneeId: "user-2",
        reporterId: "user-3",
        actorId: "user-1",
      });
      expect(mockCreateMany).toHaveBeenCalledOnce();
      const call = mockCreateMany.mock.calls[0][0];
      expect(call.data).toHaveLength(2);
    });

    it("skips the actor from the notification list", async () => {
      await notificationService.commentAdded({
        issueKey: "TF-1",
        issueTitle: "Test Issue",
        issueId: "issue-1",
        assigneeId: "user-1",
        reporterId: "user-1",
        actorId: "user-1",
      });
      expect(mockCreateMany).not.toHaveBeenCalled();
    });
  });
});
