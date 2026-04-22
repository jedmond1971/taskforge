import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPresignedUploadUrl } from "@/lib/s3";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
]);

function isAllowedMimeType(mimeType: string): boolean {
  if (mimeType.startsWith("image/")) return true;
  return ALLOWED_MIME_TYPES.has(mimeType);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

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

    if (!isAllowedMimeType(mimeType)) {
      return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
    }

    if (fileSize > MAX_FILE_SIZE) {
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
    if (!member || !["OWNER", "ADMIN", "MEMBER"].includes(member.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const fileKey = `attachments/${issueId}/${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
    const uploadUrl = await getPresignedUploadUrl(fileKey, mimeType, fileSize);

    const attachment = await prisma.attachment.create({
      data: {
        issueId,
        uploaderId: session.user.id,
        fileName,
        fileKey,
        fileSize,
        mimeType,
      },
    });

    return NextResponse.json({ uploadUrl, key: fileKey, attachmentId: attachment.id });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
