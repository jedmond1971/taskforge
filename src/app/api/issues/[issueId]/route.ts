import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

    // Check membership
    const member = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId: session.user.id,
          projectId: issue.project.id,
        },
      },
    });
    if (!member) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json() as Record<string, unknown>;
    const allowedFields = ["title", "description", "status", "priority", "type", "assigneeId", "labels"];
    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) updates[field] = body[field];
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
    if (!member) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.issue.delete({ where: { id: params.issueId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
