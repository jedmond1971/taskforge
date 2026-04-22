import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPresignedDownloadUrl } from "@/lib/s3";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json() as { attachmentId: string };
    const { attachmentId } = body;

    if (!attachmentId) {
      return NextResponse.json({ error: "attachmentId required" }, { status: 400 });
    }

    const attachment = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        issue: { select: { projectId: true } },
        uploader: { select: { id: true, name: true } },
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
    if (!member) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.activityLog.create({
      data: {
        issueId: attachment.issueId,
        userId: session.user.id,
        action: "attached",
        field: attachment.fileName,
      },
    });

    const downloadUrl = await getPresignedDownloadUrl(attachment.fileKey);

    return NextResponse.json({
      attachment: {
        id: attachment.id,
        issueId: attachment.issueId,
        fileName: attachment.fileName,
        fileKey: attachment.fileKey,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType,
        createdAt: attachment.createdAt,
        uploader: attachment.uploader,
        downloadUrl,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
