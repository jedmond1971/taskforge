import { NextRequest, NextResponse } from "next/server";
import { requireV1ApiKey } from "@/lib/v1-auth";
import { prisma } from "@/lib/prisma";
import { listObjects, deleteObjects } from "@/lib/s3";
import { logError, securityEvent } from "@/lib/security-events";
import { checkStorageMarker, type StorageMarkerProblem } from "@/lib/storage-marker";

export const maxDuration = 60;

// Only this prefix is ever scanned or deleted. Editor images, docs files and avatars
// live under other prefixes and are deliberately out of reach.
const ATTACHMENTS_PREFIX = "attachments/";

// Objects newer than this are left alone even if no Attachment row references
// them yet — an in-flight presigned upload may not have called /confirm yet.
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/**
 * Deletion guards (module-private: a route file may only export handlers and route config). A run that would exceed any of them deletes NOTHING, answers 409 and
 * alerts the owner: a normal night leaves a handful of abandoned uploads, so a big batch
 * means something upstream is wrong (a mis-wired database, a broken Attachment write path),
 * and deleting first and asking later cannot be undone.
 *
 * The ratio only applies from MIN_ORPHANS_FOR_RATIO up, or a small instance with ten files
 * and two genuine orphans (20%) would trip it every night.
 */
const MAX_DELETIONS_PER_RUN = 50;
const MAX_DELETION_RATIO = 0.1;
const MIN_ORPHANS_FOR_RATIO = 5;

type StopReason =
  | StorageMarkerProblem
  | "no_attachment_records"
  | "too_many_orphans"
  | "orphan_ratio_too_high";

/**
 * Attachment keys are `attachments/<issueId>/<uuid>-<fileName>`. Returns the issue id,
 * so the audit line can say where files went without carrying the user's file name.
 */
function issueIdFromKey(key: string): string {
  return key.slice(ATTACHMENTS_PREFIX.length).split("/")[0] || "unknown";
}

function isDryRun(request: NextRequest): boolean {
  const v = request.nextUrl.searchParams.get("dryRun");
  return v === "1" || v === "true";
}

// POST /api/internal/cleanup-orphaned-attachments[?dryRun=1] (SECH-92)
//
// The presigned attachment upload flow (src/app/api/attachments/presign,
// confirm) can leave an S3 object with no corresponding Attachment row if
// the browser uploads to S3 but never calls /confirm (network failure, tab
// closed, etc — see SECH-90 write-up in .context-docs/data-integrity.md).
// This finds objects under attachments/ older than the grace period with no
// matching Attachment.fileKey and deletes them. Intended to be called on a
// schedule (see deploy/selfhost/cleanup.sh (jedforge-cleanup.timer)), not by
// the app itself.
//
// Before deleting anything it checks the storage marker (bucket and database must belong
// together, src/lib/storage-marker.ts) and the deletion guards above. `dryRun` runs every
// check and reports what WOULD happen, deleting nothing and alerting no one.
//
// The response carries counts and a stop reason only. Object keys contain the uploader's
// original file name, and the scheduled caller's logs are public, so which files were removed
// is recorded server-side instead (`storage.orphans_deleted`), by issue id, never by name.
export async function POST(request: NextRequest) {
  const authError = await requireV1ApiKey(request);
  if (authError) return authError;

  const dryRun = isDryRun(request);

  try {
    const marker = await checkStorageMarker();

    const objects = (await listObjects(ATTACHMENTS_PREFIX)).filter((o) =>
      o.key.startsWith(ATTACHMENTS_PREFIX)
    );
    const cutoff = Date.now() - GRACE_PERIOD_MS;
    const candidates = objects.filter((o) => o.lastModified.getTime() < cutoff);

    let orphanKeys: string[] = [];
    if (candidates.length > 0) {
      const existing = await prisma.attachment.findMany({
        where: { fileKey: { in: candidates.map((c) => c.key) } },
        select: { fileKey: true },
      });
      const existingKeys = new Set(existing.map((a) => a.fileKey));
      orphanKeys = candidates.map((c) => c.key).filter((key) => !existingKeys.has(key));
    }

    let stopReason: StopReason | null = null;
    if (!marker.ok) {
      stopReason = marker.problem;
    } else if (orphanKeys.length > 0 && (await prisma.attachment.count()) === 0) {
      // Files in storage but not one Attachment row anywhere: this database is not the one
      // these files belong to, whatever the marker says.
      stopReason = "no_attachment_records";
    } else if (orphanKeys.length > MAX_DELETIONS_PER_RUN) {
      stopReason = "too_many_orphans";
    } else if (
      orphanKeys.length >= MIN_ORPHANS_FOR_RATIO &&
      orphanKeys.length / objects.length > MAX_DELETION_RATIO
    ) {
      stopReason = "orphan_ratio_too_high";
    }

    const counts = {
      scanned: objects.length,
      candidates: candidates.length,
      wouldDelete: orphanKeys.length,
    };

    if (dryRun) {
      return NextResponse.json({ dryRun: true, ...counts, orphansDeleted: 0, stopReason });
    }

    if (stopReason) {
      securityEvent("storage.cleanup_stopped", { meta: { reason: stopReason, ...counts } });
      return NextResponse.json(
        { dryRun: false, ...counts, orphansDeleted: 0, stopReason },
        { status: 409 }
      );
    }

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

    return NextResponse.json({ dryRun: false, ...counts, orphansDeleted: orphanKeys.length, stopReason: null });
  } catch (error) {
    logError("POST /api/internal/cleanup-orphaned-attachments error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
