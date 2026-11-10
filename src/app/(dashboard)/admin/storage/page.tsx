import { requireUser } from "@/lib/auth";
import { checkStorageMarker, STORAGE_MARKER_PROBLEM_TEXT } from "@/lib/storage-marker";
import { logError } from "@/lib/security-events";
import { StorageMarkerClient } from "./StorageMarkerClient";

export const dynamic = "force-dynamic";

export default async function AdminStoragePage() {
  await requireUser();
  let state: "ok" | "not_set_up" | "problem" | "unreadable" = "unreadable";
  let message = "Could not read the storage marker. Check the bucket settings and Deploy Logs.";
  try {
    const status = await checkStorageMarker();
    if (status.ok) {
      state = "ok";
      message = "The bucket and this database belong together. The nightly cleanup can delete orphaned files.";
    } else {
      state = status.problem === "marker_not_set_up" ? "not_set_up" : "problem";
      message = STORAGE_MARKER_PROBLEM_TEXT[status.problem];
    }
  } catch (error) {
    logError("admin/storage: checkStorageMarker", error);
  }
  return <StorageMarkerClient state={state} message={message} />;
}
