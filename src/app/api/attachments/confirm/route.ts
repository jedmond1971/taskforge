import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditIssues, getUserGrants } from "@/lib/permissions";
import { getPresignedDownloadUrl, headObjectSize, getObjectBuffer, deleteObject } from "@/lib/s3";
import { MAX_ATTACHMENT_SIZE, isAllowedAttachmentMimeType } from "@/lib/upload-validation";
import { checkOrgStorageQuota } from "@/lib/storage-quota";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json() as {
      issueId: string;
      fileKey: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
    };
    const { issueId, fileKey, fileName, fileSize, mimeType } = body;

    if (!issueId || !fileKey || !fileName || !fileSize || !mimeType) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // fileKey must actually belong to this issue's presign namespace — otherwise
    // a caller could confirm an attachment record pointing at an unrelated S3
    // object (e.g. another issue's file, or an object it never uploaded).
    if (!fileKey.startsWith(`attachments/${issueId}/`)) {
      return NextResponse.json({ error: "Invalid fileKey for this issue" }, { status: 400 });
    }

    if (!isAllowedAttachmentMimeType(mimeType)) {
      return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
    }
    if (fileSize > MAX_ATTACHMENT_SIZE) {
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

    // The presigned PUT URL does not enforce the declared Content-Length at
    // the S3 level (a known limitation of query-string-authenticated presigned
    // requests), so the object must be re-inspected here before it's trusted.
    const realSize = await headObjectSize(fileKey);
    if (realSize === null) {
      return NextResponse.json({ error: "Upload did not complete" }, { status: 409 });
    }
    if (realSize !== fileSize) {
      await deleteObject(fileKey).catch(() => {});
      return NextResponse.json({ error: "Uploaded file size does not match declared size" }, { status: 400 });
    }

    // Authoritative quota enforcement point (SECH-91) — uses the real,
    // S3-verified size rather than the declared one presign fast-failed on.
    const quota = await checkOrgStorageQuota(issue.project.orgId, realSize);
    if (!quota.ok) {
      await deleteObject(fileKey).catch(() => {});
      return NextResponse.json({ error: "Organization storage quota exceeded" }, { status: 507 });
    }

    if (mimeType.startsWith("image/")) {
      try {
        const buffer = await getObjectBuffer(fileKey);
        await sharp(buffer).metadata();
      } catch {
        await deleteObject(fileKey).catch(() => {});
        return NextResponse.json({ error: "Invalid or unsupported image file" }, { status: 400 });
      }
    }

    const attachment = await prisma.attachment.create({
      data: {
        issueId,
        uploaderId: session.user.id,
        fileName,
        fileKey,
        fileSize,
        mimeType,
      },
      include: {
        uploader: { select: { id: true, name: true } },
      },
    });

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
        ...attachment,
        downloadUrl,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
