import { NextRequest, NextResponse } from "next/server";
import { requireV1ApiKey } from "@/lib/v1-auth";
import { prisma } from "@/lib/prisma";
import { listObjects, deleteObjects } from "@/lib/s3";
import { logError, securityEvent } from "@/lib/security-events";

export const maxDuration = 60;

// Only this prefix is ever scanned or deleted. Editor images, docs files and avatars
// live under other prefixes and are deliberately out of reach.
const ATTACHMENTS_PREFIX = "attachments/";

// Objects newer than this are left alone even if no Attachment row references
// them yet — an in-flight presigned upload may not have called /confirm yet.
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/**
 * Attachment keys are `attachments/<issueId>/<uuid>-<fileName>`. Returns the issue id,
 * so the audit line can say where files went without carrying the user's file name.
 */
function issueIdFromKey(key: string): string {
  return key.slice(ATTACHMENTS_PREFIX.length).split("/")[0] || "unknown";
}

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
//
// The response carries counts only. Object keys contain the uploader's original file
// name, and the scheduled caller's logs are public, so which files were removed is
// recorded server-side instead (`storage.orphans_deleted`), by issue id, never by name.
export async function POST(request: NextRequest) {
  const authError = await requireV1ApiKey(request);
  if (authError) return authError;

  try {
    const objects = (await listObjects(ATTACHMENTS_PREFIX)).filter((o) =>
      o.key.startsWith(ATTACHMENTS_PREFIX)
    );
    const cutoff = Date.now() - GRACE_PERIOD_MS;
    const candidates = objects.filter((o) => o.lastModified.getTime() < cutoff);

    if (candidates.length === 0) {
      return NextResponse.json({ scanned: objects.length, candidates: 0, orphansDeleted: 0 });
    }

    const existing = await prisma.attachment.findMany({
      where: { fileKey: { in: candidates.map((c) => c.key) } },
      select: { fileKey: true },
    });
    const existingKeys = new Set(existing.map((a) => a.fileKey));

    const orphanKeys = candidates.map((c) => c.key).filter((key) => !existingKeys.has(key));

    if (orphanKeys.length > 0) {
      await deleteObjects(orphanKeys);

      const perIssue: Record<string, number> = {};
      for (const key of orphanKeys) {
        const issueId = issueIdFromKey(key);
        perIssue[issueId] = (perIssue[issueId] ?? 0) + 1;
      }
      securityEvent("storage.orphans_deleted", {
        meta: {
          scanned: objects.length,
          candidates: candidates.length,
          orphansDeleted: orphanKeys.length,
          perIssue,
        },
      });
    }

    return NextResponse.json({
      scanned: objects.length,
      candidates: candidates.length,
      orphansDeleted: orphanKeys.length,
    });
  } catch (error) {
    logError("POST /api/internal/cleanup-orphaned-attachments error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
