import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPresignedDownloadUrl } from "@/lib/s3";
import { logError } from "@/lib/security-events";

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const attachment = await prisma.attachment.findUnique({
      where: { id: params.id },
      include: { issue: { select: { projectId: true } } },
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

    const url = await getPresignedDownloadUrl(attachment.fileKey, {
      contentType: attachment.mimeType,
      fileName: attachment.fileName,
    });
    return NextResponse.json({ url });
  } catch (error) {
    logError("GET /api/attachments/[id]/url", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
