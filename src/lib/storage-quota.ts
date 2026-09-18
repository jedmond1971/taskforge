import { prisma } from "@/lib/prisma";

// Flat limit for every organization regardless of plan (SECH-91) — tying this
// to Organization.plan would be a billing/monetization decision, which is
// explicitly out of scope here (see CLAUDE.md non-goals).
export const ORG_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

// Counts attachments and doc-page file uploads only — the two upload paths
// that already track fileSize against a project (and therefore an org) in
// the database. Editor images are not tracked in any table (see
// .context-docs/rich-text.md) and are a known, documented gap.
export async function getOrgStorageUsageBytes(orgId: string): Promise<number> {
  const [attachments, docPages] = await Promise.all([
    prisma.attachment.aggregate({
      where: { issue: { project: { orgId } } },
      _sum: { fileSize: true },
    }),
    prisma.docPage.aggregate({
      where: { docSpace: { project: { orgId } } },
      _sum: { fileSize: true },
    }),
  ]);
  return (attachments._sum.fileSize ?? 0) + (docPages._sum.fileSize ?? 0);
}

export interface QuotaCheckResult {
  ok: boolean;
  usedBytes: number;
  quotaBytes: number;
}

/**
 * Checks whether adding `incomingBytes` would push the org over quota.
 * Pass `replacingBytes` (the size of a file being overwritten in the same
 * operation) so the check doesn't double-count storage that's about to be
 * freed — e.g. replacing a doc page's file.
 */
export async function checkOrgStorageQuota(
  orgId: string,
  incomingBytes: number,
  replacingBytes = 0
): Promise<QuotaCheckResult> {
  const usedBytes = await getOrgStorageUsageBytes(orgId);
  const projectedBytes = usedBytes - replacingBytes + incomingBytes;
  return { ok: projectedBytes <= ORG_STORAGE_QUOTA_BYTES, usedBytes, quotaBytes: ORG_STORAGE_QUOTA_BYTES };
}
