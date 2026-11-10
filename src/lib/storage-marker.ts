import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getObjectTextOrNull, putObject, deleteObject } from "@/lib/s3";

/**
 * Storage marker (SECH-92 follow-up).
 *
 * The orphaned-attachment cleanup decides a file is an orphan because THIS database has no
 * Attachment row for it. That is only true if the bucket and the database belong together.
 * An app pointed at production's bucket but a different database (a staging copy, a restored
 * backup) would see every customer file as an orphan and delete it.
 *
 * So the same random id is stored in both places, and the cleanup refuses to delete unless
 * they match. The marker is never created automatically: if it were, the very first run of a
 * mis-wired app would bind the bucket to the wrong database. A platform admin creates it once,
 * from Admin → Storage, and only when neither half exists yet.
 */

/** Outside `attachments/`, so the cleanup's own listing can never see or delete it. */
export const STORAGE_MARKER_KEY = ".jedforge/storage-marker.json";
export const STORAGE_MARKER_SETTING = "storage.instanceId";

export type StorageMarkerProblem =
  | "marker_not_set_up" // neither half exists: never created (expected once, before setup)
  | "marker_missing_in_database" // the bucket has a marker this database does not know
  | "marker_missing_in_storage" // this database has a marker the bucket does not
  | "marker_mismatch"; // both exist and disagree: the bucket belongs to another database

export type StorageMarkerStatus =
  | { ok: true }
  | { ok: false; problem: StorageMarkerProblem };

/** Plain-language explanation for each problem, shared by the admin page and the docs. */
export const STORAGE_MARKER_PROBLEM_TEXT: Record<StorageMarkerProblem, string> = {
  marker_not_set_up: "The storage marker has not been created yet. Create it once from this page.",
  marker_missing_in_database:
    "The bucket has a storage marker but this database does not. This app may be pointed at another environment's bucket. Do not create a new marker until you know why.",
  marker_missing_in_storage:
    "This database has a storage marker but the bucket does not. This app may be pointed at the wrong bucket. Do not create a new marker until you know why.",
  marker_mismatch:
    "The bucket's storage marker does not match this database's. This app's bucket belongs to a different database. Do not delete or recreate either marker until you know why.",
};

function parseBucketMarker(text: string | null): string | null {
  if (text === null) return null;
  try {
    const value = (JSON.parse(text) as { instanceId?: unknown }).instanceId;
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function readBothHalves(): Promise<{ db: string | null; bucket: string | null; bucketPresent: boolean }> {
  const [setting, text] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: STORAGE_MARKER_SETTING } }),
    getObjectTextOrNull(STORAGE_MARKER_KEY),
  ]);
  return { db: setting?.value ?? null, bucket: parseBucketMarker(text), bucketPresent: text !== null };
}

/** Errors reading either half propagate: an unreadable marker is never treated as a match. */
export async function checkStorageMarker(): Promise<StorageMarkerStatus> {
  const { db, bucket, bucketPresent } = await readBothHalves();
  if (!db && !bucketPresent) return { ok: false, problem: "marker_not_set_up" };
  if (!db) return { ok: false, problem: "marker_missing_in_database" };
  if (!bucketPresent) return { ok: false, problem: "marker_missing_in_storage" };
  // A present-but-unreadable bucket marker is a disagreement, not a match.
  if (bucket !== db) return { ok: false, problem: "marker_mismatch" };
  return { ok: true };
}

/**
 * Creates both halves, only when neither exists. Refuses every other state, so it can never
 * paper over a mis-wired environment.
 */
export async function createStorageMarker(): Promise<{ created: true } | { created: false; problem: StorageMarkerProblem | "already_set_up" }> {
  const status = await checkStorageMarker();
  if (status.ok) return { created: false, problem: "already_set_up" };
  if (status.problem !== "marker_not_set_up") return { created: false, problem: status.problem };

  const instanceId = randomUUID();
  // Database first: the primary key makes a concurrent second click fail here, before it
  // can write a different id to the bucket.
  await prisma.appSetting.create({ data: { key: STORAGE_MARKER_SETTING, value: instanceId } });
  try {
    await putObject(STORAGE_MARKER_KEY, Buffer.from(JSON.stringify({ instanceId })), "application/json");
  } catch (error) {
    await prisma.appSetting.delete({ where: { key: STORAGE_MARKER_SETTING } }).catch(() => {});
    // Best effort: a partial write must not leave a lone bucket half either.
    await deleteObject(STORAGE_MARKER_KEY).catch(() => {});
    throw error;
  }
  return { created: true };
}
