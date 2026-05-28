import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/s3";
import { canEditIssues } from "@/lib/permissions";
import { notificationService } from "@/lib/notifications";
import { sanitizeTipTapHtml } from "@/lib/sanitize-html";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { issueId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const issue = await prisma.issue.findUnique({
      where: { id: params.issueId },
      include: { project: { select: { id: true } } },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    // Check membership and edit role
    const member = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId: session.user.id,
          projectId: issue.project.id,
        },
      },
    });
    if (!member || !canEditIssues(member.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json() as Record<string, unknown>;
    const allowedFields = ["title", "description", "status", "priority", "type", "assigneeId", "labels"];
    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) updates[field] = body[field];
    }

    if (typeof updates.description === "string") {
      updates.description = sanitizeTipTapHtml(updates.description);
    }

    if (updates.assigneeId != null) {
      const assigneeMember = await prisma.projectMember.findUnique({
        where: {
          userId_projectId: {
            userId: updates.assigneeId as string,
            projectId: issue.project.id,
          },
        },
      });
      if (!assigneeMember) {
        return NextResponse.json({ error: "Assignee is not a member of this project" }, { status: 400 });
      }
    }

    // Log changes
    const logs: Array<{
      issueId: string;
      userId: string;
      action: string;
      field: string;
      oldValue: string;
      newValue: string;
    }> = [];

    for (const field of Object.keys(updates)) {
      const oldRaw = issue[field as keyof typeof issue];
      const newRaw = updates[field];
      const oldValue = Array.isArray(oldRaw) ? (oldRaw as string[]).join(", ") : String(oldRaw ?? "");
      const newValue = Array.isArray(newRaw) ? (newRaw as string[]).join(", ") : String(newRaw ?? "");
      if (oldValue !== newValue) {
        logs.push({ issueId: issue.id, userId: session.user.id, action: "updated", field, oldValue, newValue });
      }
    }

    const updated = await prisma.issue.update({
      where: { id: params.issueId },
      data: updates,
    });

    if (logs.length > 0) {
      await prisma.activityLog.createMany({ data: logs });
    }

    if (
      "assigneeId" in updates &&
      updates.assigneeId != null &&
      updates.assigneeId !== issue.assigneeId
    ) {
      await notificationService.issueAssigned({
        assigneeId: updates.assigneeId as string,
        issueKey: issue.key,
        issueTitle: issue.title,
        issueId: issue.id,
        actorId: session.user.id,
      });
    }

    if (
      "status" in updates &&
      updates.status !== undefined &&
      updates.status !== issue.status
    ) {
      await notificationService.statusChanged({
        issueKey: issue.key,
        issueTitle: issue.title,
        issueId: issue.id,
        newStatus: updates.status as string,
        assigneeId: issue.assigneeId,
        reporterId: issue.reporterId,
        actorId: session.user.id,
      });
    }

    return NextResponse.json({ issue: updated });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { issueId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const issue = await prisma.issue.findUnique({
      where: { id: params.issueId },
      include: { project: { select: { id: true } } },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    const member = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId: session.user.id,
          projectId: issue.project.id,
        },
      },
    });
    if (!member || !canEditIssues(member.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Clean up S3 objects before cascading the DB delete
    const attachments = await prisma.attachment.findMany({
      where: { issueId: params.issueId },
      select: { fileKey: true },
    });
    for (const att of attachments) {
      try {
        await deleteObject(att.fileKey);
      } catch (e) {
        console.error(`Failed to delete S3 attachment ${att.fileKey}:`, e);
      }
    }

    await prisma.issue.delete({ where: { id: params.issueId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
