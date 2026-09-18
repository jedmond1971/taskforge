import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPresignedUploadUrl } from "@/lib/s3";
import { MAX_ATTACHMENT_SIZE, isAllowedAttachmentMimeType, sanitizeFileName } from "@/lib/upload-validation";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json() as {
      issueId: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    };
    const { issueId, fileName, fileSize, mimeType } = body;

    if (!issueId || !fileName || !fileSize || !mimeType) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (!isAllowedAttachmentMimeType(mimeType)) {
      return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
    }

    if (fileSize > MAX_ATTACHMENT_SIZE) {
      return NextResponse.json({ error: "File exceeds 20 MB limit" }, { status: 400 });
    }

    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { projectId: true },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    const member = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: { userId: session.user.id, projectId: issue.projectId },
      },
    });
    if (!member || !["PROJECT_LEAD", "TEAM_MEMBER"].includes(member.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // The Attachment row is deliberately NOT created here (SECH-90) — the
    // browser hasn't uploaded anything yet at this point, so a row created
    // now would be visible to every project member via GET /api/attachments
    // before the S3 object exists, and would never get cleaned up if the
    // upload is abandoned. confirm/route.ts creates it only after verifying
    // the real object in S3.
    const fileKey = `attachments/${issueId}/${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
    const uploadUrl = await getPresignedUploadUrl(fileKey, mimeType, fileSize);

    return NextResponse.json({ uploadUrl, key: fileKey });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
