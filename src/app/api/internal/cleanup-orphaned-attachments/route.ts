import { NextRequest, NextResponse } from "next/server";
import { requireV1ApiKey } from "@/lib/v1-auth";
import { prisma } from "@/lib/prisma";
import { listObjects, deleteObjects } from "@/lib/s3";
import { logError } from "@/lib/security-events";

export const maxDuration = 60;

// Objects newer than this are left alone even if no Attachment row references
// them yet — an in-flight presigned upload may not have called /confirm yet.
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

// POST /api/internal/cleanup-orphaned-attachments (SECH-92)
//
// The presigned attachment upload flow (src/app/api/attachments/presign,
// confirm) can leave an S3 object with no corresponding Attachment row if
// the browser uploads to S3 but never calls /confirm (network failure, tab
// closed, etc — see SECH-90 write-up in .context-docs/data-integrity.md).
// This finds objects under attachments/ older than the grace period with no
// matching Attachment.fileKey and deletes them. Intended to be called on a
// schedule (see .github/workflows/cleanup-orphaned-attachments.yml), not by
// the app itself.
export async function POST(request: NextRequest) {
  const authError = await requireV1ApiKey(request);
  if (authError) return authError;

  try {
    const objects = await listObjects("attachments/");
    const cutoff = Date.now() - GRACE_PERIOD_MS;
    const candidates = objects.filter((o) => o.lastModified.getTime() < cutoff);

    if (candidates.length === 0) {
      return NextResponse.json({ scanned: objects.length, candidates: 0, orphansDeleted: 0, deletedKeys: [] });
    }

    const existing = await prisma.attachment.findMany({
      where: { fileKey: { in: candidates.map((c) => c.key) } },
      select: { fileKey: true },
    });
    const existingKeys = new Set(existing.map((a) => a.fileKey));

    const orphanKeys = candidates.map((c) => c.key).filter((key) => !existingKeys.has(key));

    if (orphanKeys.length > 0) {
      await deleteObjects(orphanKeys);
    }

    return NextResponse.json({
      scanned: objects.length,
      candidates: candidates.length,
      orphansDeleted: orphanKeys.length,
      deletedKeys: orphanKeys,
    });
  } catch (error) {
    logError("POST /api/internal/cleanup-orphaned-attachments error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
