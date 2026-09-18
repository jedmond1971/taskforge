import { getOrgStorageUsageBytes, ORG_STORAGE_QUOTA_BYTES } from "@/lib/storage-quota";

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export async function StorageUsageSettings({ orgId }: { orgId: string }) {
  const usedBytes = await getOrgStorageUsageBytes(orgId);
  const percentUsed = Math.min(100, (usedBytes / ORG_STORAGE_QUOTA_BYTES) * 100);
  const isNearLimit = percentUsed >= 90;

  return (
    <div>
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Storage</h2>
      <p className="text-sm text-zinc-500 mt-1 mb-4">
        Attachments and document files uploaded across this organization.
      </p>

      <div className="flex items-baseline justify-between text-sm mb-2">
        <span className="text-zinc-700 dark:text-zinc-300">
          {formatBytes(usedBytes)} of {formatBytes(ORG_STORAGE_QUOTA_BYTES)} used
        </span>
        <span className="text-zinc-500">{percentUsed.toFixed(1)}%</span>
      </div>

      <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isNearLimit ? "bg-red-500" : "bg-primary"}`}
          style={{ width: `${percentUsed}%` }}
        />
      </div>

      {isNearLimit && (
        <p className="text-sm text-red-600 dark:text-red-400 mt-2">
          Approaching the organization storage limit. New attachment and document-file uploads will be
          rejected once the limit is reached.
        </p>
      )}
    </div>
  );
}
