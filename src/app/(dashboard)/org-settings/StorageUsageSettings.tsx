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
      <h2 className="text-lg font-semibold text-foreground">Storage</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        Attachments and document files uploaded across this organization.
      </p>

      <div className="flex items-baseline justify-between text-sm mb-2">
        <span className="text-foreground">
          {formatBytes(usedBytes)} of {formatBytes(ORG_STORAGE_QUOTA_BYTES)} used
        </span>
        <span className="text-muted-foreground">{percentUsed.toFixed(1)}%</span>
      </div>

      <div className="h-2 rounded-full bg-surface-active overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isNearLimit ? "bg-danger" : "bg-primary"}`}
          style={{ width: `${percentUsed}%` }}
        />
      </div>

      {isNearLimit && (
        <p className="text-sm text-danger mt-2">
          Approaching the organization storage limit. New attachment and document-file uploads will be
          rejected once the limit is reached.
        </p>
      )}
    </div>
  );
}
