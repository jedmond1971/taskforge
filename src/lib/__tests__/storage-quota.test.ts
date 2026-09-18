import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    attachment: { aggregate: vi.fn() },
    docPage: { aggregate: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { getOrgStorageUsageBytes, checkOrgStorageQuota, ORG_STORAGE_QUOTA_BYTES } from "@/lib/storage-quota";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOrgStorageUsageBytes", () => {
  it("sums attachment and doc-page file sizes", async () => {
    mockPrisma.attachment.aggregate.mockResolvedValue({ _sum: { fileSize: 100 } });
    mockPrisma.docPage.aggregate.mockResolvedValue({ _sum: { fileSize: 250 } });
    expect(await getOrgStorageUsageBytes("org-1")).toBe(350);
  });

  it("treats a null sum (no rows) as zero", async () => {
    mockPrisma.attachment.aggregate.mockResolvedValue({ _sum: { fileSize: null } });
    mockPrisma.docPage.aggregate.mockResolvedValue({ _sum: { fileSize: null } });
    expect(await getOrgStorageUsageBytes("org-1")).toBe(0);
  });

  it("scopes both aggregates to the given org", async () => {
    mockPrisma.attachment.aggregate.mockResolvedValue({ _sum: { fileSize: 0 } });
    mockPrisma.docPage.aggregate.mockResolvedValue({ _sum: { fileSize: 0 } });
    await getOrgStorageUsageBytes("org-42");
    expect(mockPrisma.attachment.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { issue: { project: { orgId: "org-42" } } } })
    );
    expect(mockPrisma.docPage.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { docSpace: { project: { orgId: "org-42" } } } })
    );
  });
});

describe("checkOrgStorageQuota", () => {
  beforeEach(() => {
    mockPrisma.attachment.aggregate.mockResolvedValue({ _sum: { fileSize: 0 } });
    mockPrisma.docPage.aggregate.mockResolvedValue({ _sum: { fileSize: 0 } });
  });

  it("allows an upload well under quota", async () => {
    const result = await checkOrgStorageQuota("org-1", 1000);
    expect(result.ok).toBe(true);
    expect(result.quotaBytes).toBe(ORG_STORAGE_QUOTA_BYTES);
  });

  it("rejects an upload that would push the org over quota", async () => {
    mockPrisma.attachment.aggregate.mockResolvedValue({ _sum: { fileSize: ORG_STORAGE_QUOTA_BYTES - 100 } });
    const result = await checkOrgStorageQuota("org-1", 1000);
    expect(result.ok).toBe(false);
  });

  it("allows an upload that lands exactly on the quota boundary", async () => {
    mockPrisma.attachment.aggregate.mockResolvedValue({ _sum: { fileSize: ORG_STORAGE_QUOTA_BYTES - 1000 } });
    const result = await checkOrgStorageQuota("org-1", 1000);
    expect(result.ok).toBe(true);
  });

  it("does not double-count storage being replaced in the same operation", async () => {
    // Org is essentially full, but the incoming file replaces one of the
    // exact same size — net usage doesn't change, so this must be allowed.
    mockPrisma.docPage.aggregate.mockResolvedValue({ _sum: { fileSize: ORG_STORAGE_QUOTA_BYTES } });
    const result = await checkOrgStorageQuota("org-1", 5000, 5000);
    expect(result.ok).toBe(true);
  });

  it("still rejects a replacement that grows past quota", async () => {
    mockPrisma.docPage.aggregate.mockResolvedValue({ _sum: { fileSize: ORG_STORAGE_QUOTA_BYTES } });
    const result = await checkOrgStorageQuota("org-1", 5000, 1000); // net +4000 over a full org
    expect(result.ok).toBe(false);
  });
});
