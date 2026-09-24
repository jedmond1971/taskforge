import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditIssues, getUserGrants } from "@/lib/permissions";
import { putObject, getPresignedDownloadUrl } from "@/lib/s3";
import {
  MAX_ATTACHMENT_SIZE,
  isAllowedAttachmentMimeType,
  isAllowedImageMimeType,
  sanitizeFileName,
  validateRasterImage,
} from "@/lib/upload-validation";
import { checkOrgStorageQuota } from "@/lib/storage-quota";
import { securityEvent } from "@/lib/security-events";
import { requestIdFromHeaders } from "@/lib/request-id";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requestId = requestIdFromHeaders(request.headers);
    const userId = session.user.id;

    const formData = await request.formData();
    const issueId = formData.get("issueId") as string | null;
    const file = formData.get("file") as File | null;

    if (!issueId || !file) {
      return NextResponse.json({ error: "Missing issueId or file" }, { status: 400 });
    }

    if (!isAllowedAttachmentMimeType(file.type)) {
      securityEvent("upload.rejected", {
        requestId,
        userId,
        meta: { reason: "mime_type", declaredType: file.type, route: "upload" },
      });
      return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
    }

    if (file.size > MAX_ATTACHMENT_SIZE) {
      securityEvent("upload.rejected", {
        requestId,
        userId,
        meta: { reason: "size", fileSize: file.size, route: "upload" },
      });
      return NextResponse.json({ error: "File exceeds 20 MB limit" }, { status: 400 });
    }

    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { projectId: true, project: { select: { orgId: true } } },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    const member = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: { userId: session.user.id, projectId: issue.projectId },
      },
    });
    if (!member) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // canEditIssues (not a hard-coded role list) so an ISSUE_EDIT group grant
    // applies to attachments like it does everywhere else (SECH-96).
    const grants = await getUserGrants(session.user.id, issue.project.orgId, issue.projectId);
    if (!canEditIssues(member.role, grants)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const quota = await checkOrgStorageQuota(issue.project.orgId, file.size);
    if (!quota.ok) {
      return NextResponse.json({ error: "Organization storage quota exceeded" }, { status: 507 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Image attachments must be real PNG/JPEG/GIF/WebP whose bytes match the
    // declared type — never SVG or spoofed bytes (SECH-88/90, SECH-125).
    if (isAllowedImageMimeType(file.type) && !(await validateRasterImage(buffer, file.type))) {
      securityEvent("upload.rejected", {
        requestId,
        userId,
        meta: { reason: "not_raster_image", declaredType: file.type, route: "upload" },
      });
      return NextResponse.json({ error: "Invalid or unsupported image file" }, { status: 400 });
    }

    const fileKey = `attachments/${issueId}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
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

    const downloadUrl = await getPresignedDownloadUrl(fileKey, {
      contentType: attachment.mimeType,
      fileName: attachment.fileName,
    });

    return NextResponse.json({
      attachment: { ...attachment, downloadUrl },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
