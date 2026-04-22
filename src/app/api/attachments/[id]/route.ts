import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/s3";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const attachment = await prisma.attachment.findUnique({
      where: { id: params.id },
      include: {
        issue: { select: { projectId: true } },
      },
    });
    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    const member = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId: session.user.id,
          projectId: attachment.issue.projectId,
        },
      },
    });

    const isUploader = attachment.uploaderId === session.user.id;
    const isPrivileged = member && ["OWNER", "ADMIN"].includes(member.role);

    if (!isUploader && !isPrivileged) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await deleteObject(attachment.fileKey);
    await prisma.attachment.delete({ where: { id: params.id } });

    await prisma.activityLog.create({
      data: {
        issueId: attachment.issueId,
        userId: session.user.id,
        action: "removed_attachment",
        field: attachment.fileName,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
