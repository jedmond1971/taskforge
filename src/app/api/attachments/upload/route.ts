import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { putObject, getPresignedDownloadUrl } from "@/lib/s3";

export const maxDuration = 60;

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const ALLOWED_MIME_PREFIXES = ["image/"];
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
  if (ALLOWED_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return true;
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

    const formData = await request.formData();
    const issueId = formData.get("issueId") as string | null;
    const file = formData.get("file") as File | null;

    if (!issueId || !file) {
      return NextResponse.json({ error: "Missing issueId or file" }, { status: 400 });
    }

    if (!isAllowedMimeType(file.type)) {
      return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
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

    const fileKey = `attachments/${issueId}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(fileKey, buffer, file.type);

    const attachment = await prisma.attachment.create({
      data: {
        issueId,
        uploaderId: session.user.id,
        fileName: file.name,
        fileKey,
        fileSize: file.size,
        mimeType: file.type,
      },
      include: { uploader: { select: { id: true, name: true } } },
    });

    await prisma.activityLog.create({
      data: {
        issueId,
        userId: session.user.id,
        action: "attached",
        field: file.name,
      },
    });

    const downloadUrl = await getPresignedDownloadUrl(fileKey);

    return NextResponse.json({
      attachment: { ...attachment, downloadUrl },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
