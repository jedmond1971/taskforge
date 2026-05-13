import { prisma } from "@/lib/prisma";
import { NotificationType } from "@prisma/client";

async function createNotification({
  type,
  message,
  userId,
  issueId,
  actorId,
}: {
  type: NotificationType;
  message: string;
  userId: string | null | undefined;
  issueId?: string;
  actorId?: string;
}) {
  if (!userId) return;
  if (userId === actorId) return;

  try {
    await prisma.notification.create({
      data: { type, message, userId, issueId: issueId ?? null },
    });
  } catch (error) {
    console.error("[notifications] Failed to create notification:", error);
  }
}

async function createNotifications({
  type,
  message,
  userIds,
  issueId,
  actorId,
}: {
  type: NotificationType;
  message: string;
  userIds: (string | null | undefined)[];
  issueId?: string;
  actorId?: string;
}) {
  const targets = [...new Set(userIds.filter(Boolean))] as string[];
  const filtered = actorId ? targets.filter((id) => id !== actorId) : targets;
  if (filtered.length === 0) return;

  try {
    await prisma.notification.createMany({
      data: filtered.map((userId) => ({
        type,
        message,
        userId,
        issueId: issueId ?? null,
      })),
      skipDuplicates: true,
    });
  } catch (error) {
    console.error("[notifications] Failed to create notifications:", error);
  }
}

export const notificationService = {
  issueAssigned: (params: {
    assigneeId: string;
    issueKey: string;
    issueTitle: string;
    issueId: string;
    actorId: string;
  }) =>
    createNotification({
      type: NotificationType.ISSUE_ASSIGNED,
      message: `You were assigned to ${params.issueKey}: ${params.issueTitle}`,
      userId: params.assigneeId,
      issueId: params.issueId,
      actorId: params.actorId,
    }),

  commentAdded: (params: {
    issueKey: string;
    issueTitle: string;
    issueId: string;
    assigneeId: string | null | undefined;
    reporterId: string | null | undefined;
    actorId: string;
  }) =>
    createNotifications({
      type: NotificationType.COMMENT_ADDED,
      message: `New comment on ${params.issueKey}: ${params.issueTitle}`,
      userIds: [params.assigneeId, params.reporterId],
      issueId: params.issueId,
      actorId: params.actorId,
    }),

  statusChanged: (params: {
    issueKey: string;
    issueTitle: string;
    issueId: string;
    newStatus: string;
    assigneeId: string | null | undefined;
    reporterId: string | null | undefined;
    actorId: string;
  }) =>
    createNotifications({
      type: NotificationType.STATUS_CHANGED,
      message: `${params.issueKey} status changed to ${params.newStatus}`,
      userIds: [params.assigneeId, params.reporterId],
      issueId: params.issueId,
      actorId: params.actorId,
    }),

  mention: (params: {
    mentionedUserId: string;
    issueKey: string;
    issueTitle: string;
    issueId: string;
    actorId: string;
  }) =>
    createNotification({
      type: NotificationType.MENTION,
      message: `You were mentioned in ${params.issueKey}: ${params.issueTitle}`,
      userId: params.mentionedUserId,
      issueId: params.issueId,
      actorId: params.actorId,
    }),
};
