import { prisma } from "@/lib/prisma";

export type AuditAction =
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_DELETED"
  | "PASSWORD_RESET"
  | "ROLE_CHANGED"
  | "USER_ADDED_TO_PROJECT"
  | "ORG_CREATED"
  | "ORG_DELETED"
  | "ORG_MEMBER_ADDED"
  | "ORG_MEMBER_REMOVED"
  | "PROJECT_DELETED"
  | "PROJECT_CLOSED"
  | "PROJECT_REOPENED"
  | "INVITE_CREATED"
  | "INVITE_RESENT"
  | "INVITE_REVOKED";

export type AuditTargetType = "User" | "Organization" | "Project" | "OrgInvite" | "OrgMember";

export async function logAdminAction(params: {
  actorId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string;
  targetLabel: string;
  metadata?: Record<string, unknown>;
}) {
  const actor = await prisma.user.findUnique({
    where: { id: params.actorId },
    select: { name: true, email: true },
  });

  await prisma.adminAuditLog.create({
    data: {
      actorId: params.actorId,
      actorName: actor?.name ?? "Unknown",
      actorEmail: actor?.email ?? "unknown",
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      targetLabel: params.targetLabel,
      metadata: params.metadata as object | undefined,
    },
  });
}
