import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditIssues, getUserGrants } from "@/lib/permissions";
import { getPresignedUploadUrl } from "@/lib/s3";
import { MAX_ATTACHMENT_SIZE, isAllowedAttachmentMimeType, sanitizeFileName } from "@/lib/upload-validation";
import { checkOrgStorageQuota } from "@/lib/storage-quota";
import { securityEvent } from "@/lib/security-events";
import { requestIdFromHeaders } from "@/lib/request-id";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requestId = requestIdFromHeaders(request.headers);
    const userId = session.user.id;

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
      securityEvent("upload.rejected", {
        requestId,
        userId,
        meta: { reason: "mime_type", declaredType: mimeType, route: "presign" },
      });
      return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
    }

    if (fileSize > MAX_ATTACHMENT_SIZE) {
      securityEvent("upload.rejected", {
        requestId,
        userId,
        meta: { reason: "size", fileSize, route: "presign" },
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

    // Fast-fail on the declared size so the client doesn't waste a presigned
    // upload — confirm/route.ts re-checks against the real uploaded size,
    // which is the authoritative enforcement point (SECH-91).
    const quota = await checkOrgStorageQuota(issue.project.orgId, fileSize);
    if (!quota.ok) {
      return NextResponse.json({ error: "Organization storage quota exceeded" }, { status: 507 });
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
