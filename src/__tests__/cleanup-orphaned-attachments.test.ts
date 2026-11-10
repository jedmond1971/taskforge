import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPrisma, mockListObjects, mockDeleteObjects, mockRateLimit, mockMarker } = vi.hoisted(() => ({
  mockPrisma: { attachment: { findMany: vi.fn(), count: vi.fn() } },
  mockListObjects: vi.fn(),
  mockDeleteObjects: vi.fn().mockResolvedValue(undefined),
  mockRateLimit: {
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
    recordFailure: vi.fn(),
    getClientIp: vi.fn().mockReturnValue("203.0.113.5"),
    V1_API_RATE_LIMIT: { maxAttempts: 10, windowMs: 15 * 60 * 1000 },
  },
  mockMarker: { checkStorageMarker: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/s3", () => ({
  listObjects: mockListObjects,
  deleteObjects: mockDeleteObjects,
}));
vi.mock("@/lib/rate-limit", () => mockRateLimit);
vi.mock("@/lib/storage-marker", () => mockMarker);

import { NextRequest } from "next/server";
import { POST as cleanup } from "@/app/api/internal/cleanup-orphaned-attachments/route";

const OLD = new Date(Date.now() - 48 * 60 * 60 * 1000); // 2 days old
const RECENT = new Date(Date.now() - 60 * 1000); // 1 minute old

function request(
  { dryRun = false, headers = { "X-Internal-Api-Key": "test-key" } }: { dryRun?: boolean; headers?: Record<string, string> } = {}
): NextRequest {
  const url = `http://localhost/api/internal/cleanup-orphaned-attachments${dryRun ? "?dryRun=1" : ""}`;
  return new NextRequest(url, { method: "POST", headers });
}

/** n old objects under one issue, none with an Attachment row (all orphans). */
function oldOrphans(n: number, issue = "i1") {
  return Array.from({ length: n }, (_, i) => ({ key: `attachments/${issue}/orphan-${i}.pdf`, lastModified: OLD, size: 1 }));
}
/** n old objects that DO have Attachment rows. */
function oldAttached(n: number) {
  return Array.from({ length: n }, (_, i) => ({ key: `attachments/kept/kept-${i}.pdf`, lastModified: OLD, size: 1 }));
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.V1_API_KEY = "test-key";
  mockMarker.checkStorageMarker.mockResolvedValue({ ok: true });
  mockListObjects.mockResolvedValue([]);
  // By default every key whose name starts with "kept-" has a row.
  mockPrisma.attachment.findMany.mockImplementation(async ({ where }: { where: { fileKey: { in: string[] } } }) =>
    where.fileKey.in.filter((k) => k.includes("/kept-") || k.includes("confirmed")).map((fileKey) => ({ fileKey }))
  );
  mockPrisma.attachment.count.mockResolvedValue(100);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const events = () =>
  warn.mock.calls
    .map((c) => {
      try {
        return JSON.parse(String(c[0]));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
const eventOf = (type: string) => events().find((e) => e.type === type);

describe("POST /api/internal/cleanup-orphaned-attachments", () => {
  it("returns 401 without the internal API key", async () => {
    const res = await cleanup(request({ headers: {} }));
    expect(res.status).toBe(401);
    expect(mockListObjects).not.toHaveBeenCalled();
  });

  it("leaves recently-uploaded objects alone even with no DB row (grace period)", async () => {
    mockListObjects.mockResolvedValue([{ key: "attachments/i1/new.pdf", lastModified: RECENT, size: 10 }]);
    const res = await cleanup(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates).toBe(0);
    expect(body.orphansDeleted).toBe(0);
    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  it("deletes old objects with no matching Attachment row", async () => {
    mockListObjects.mockResolvedValue([...oldOrphans(1), ...oldAttached(19)]);
    const res = await cleanup(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ dryRun: false, scanned: 20, candidates: 20, wouldDelete: 1, orphansDeleted: 1, stopReason: null });
    expect(mockDeleteObjects).toHaveBeenCalledWith(["attachments/i1/orphan-0.pdf"]);
  });

  it("does not call deleteObjects when every old object still has a row", async () => {
    mockListObjects.mockResolvedValue(oldAttached(3));
    const res = await cleanup(request());
    expect((await res.json()).orphansDeleted).toBe(0);
    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  it("only scans the attachments/ prefix and never deletes an object outside it", async () => {
    mockListObjects.mockResolvedValue([
      ...oldOrphans(1),
      ...oldAttached(19),
      // Defensive: even if a listing ever returned other prefixes, they are not touched.
      { key: "editor-images/abc.png", lastModified: OLD, size: 10 },
      { key: "docs/space/page/file.docx", lastModified: OLD, size: 10 },
      { key: "avatars/user1.jpg", lastModified: OLD, size: 10 },
      { key: ".jedforge/storage-marker.json", lastModified: OLD, size: 10 },
    ]);
    const res = await cleanup(request());
    expect(res.status).toBe(200);
    expect(mockListObjects).toHaveBeenCalledWith("attachments/");
    expect(mockDeleteObjects).toHaveBeenCalledTimes(1);
    expect(mockDeleteObjects).toHaveBeenCalledWith(["attachments/i1/orphan-0.pdf"]);
    expect((await res.json()).scanned).toBe(20);
  });

  it("deletes nothing when the Attachment lookup fails", async () => {
    mockListObjects.mockResolvedValue([{ key: "attachments/i1/maybe-attached.pdf", lastModified: OLD, size: 10 }]);
    mockPrisma.attachment.findMany.mockRejectedValue(new Error("connection refused"));
    const res = await cleanup(request());
    expect(res.status).toBe(500);
    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(await res.text()).not.toContain("maybe-attached.pdf");
  });

  it("deletes nothing when the storage marker cannot be read", async () => {
    mockListObjects.mockResolvedValue(oldOrphans(1));
    mockMarker.checkStorageMarker.mockRejectedValue(new Error("SignatureDoesNotMatch"));
    const res = await cleanup(request());
    expect(res.status).toBe(500);
    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });
});

describe("storage marker gate", () => {
  for (const problem of ["marker_not_set_up", "marker_missing_in_database", "marker_missing_in_storage", "marker_mismatch"]) {
    it(`${problem}: deletes nothing, answers 409 with the reason, raises a critical event`, async () => {
      mockMarker.checkStorageMarker.mockResolvedValue({ ok: false, problem });
      mockListObjects.mockResolvedValue([...oldOrphans(1), ...oldAttached(19)]);

      const res = await cleanup(request());
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ stopReason: problem, wouldDelete: 1, orphansDeleted: 0 });
      expect(mockDeleteObjects).not.toHaveBeenCalled();
      expect(eventOf("storage.cleanup_stopped")).toMatchObject({ severity: "critical", meta: { reason: problem } });
    });
  }

  it("refuses even when there is nothing to delete, so a missing marker can never go unnoticed", async () => {
    mockMarker.checkStorageMarker.mockResolvedValue({ ok: false, problem: "marker_not_set_up" });
    mockListObjects.mockResolvedValue([]);
    const res = await cleanup(request());
    expect(res.status).toBe(409);
    expect((await res.json()).stopReason).toBe("marker_not_set_up");
  });
});

describe("deletion guards", () => {
  it("stops above 50 orphans in one run", async () => {
    mockListObjects.mockResolvedValue([...oldOrphans(51), ...oldAttached(1000)]);
    const res = await cleanup(request());
    expect(res.status).toBe(409);
    expect((await res.json()).stopReason).toBe("too_many_orphans");
    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(eventOf("storage.cleanup_stopped")?.meta.reason).toBe("too_many_orphans");
  });

  it("allows exactly 50 when they are under 10% of what it scanned", async () => {
    mockListObjects.mockResolvedValue([...oldOrphans(50), ...oldAttached(950)]);
    const res = await cleanup(request());
    expect(res.status).toBe(200);
    expect(mockDeleteObjects).toHaveBeenCalledTimes(1);
  });

  it("stops when orphans are more than 10% of what it scanned", async () => {
    mockListObjects.mockResolvedValue([...oldOrphans(6), ...oldAttached(44)]); // 12%
    const res = await cleanup(request());
    expect(res.status).toBe(409);
    expect((await res.json()).stopReason).toBe("orphan_ratio_too_high");
    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  it("does not apply the ratio to a handful of orphans on a small instance", async () => {
    mockListObjects.mockResolvedValue([...oldOrphans(4), ...oldAttached(6)]); // 40%, but only 4
    const res = await cleanup(request());
    expect(res.status).toBe(200);
    expect(mockDeleteObjects).toHaveBeenCalledTimes(1);
  });

  it("stops when storage has files but the database has no Attachment rows at all", async () => {
    mockListObjects.mockResolvedValue(oldOrphans(2));
    mockPrisma.attachment.count.mockResolvedValue(0);
    const res = await cleanup(request());
    expect(res.status).toBe(409);
    expect((await res.json()).stopReason).toBe("no_attachment_records");
    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });
});

describe("dry run", () => {
  it("reports what it would delete and deletes nothing", async () => {
    mockListObjects.mockResolvedValue([...oldOrphans(2), ...oldAttached(28)]);
    const res = await cleanup(request({ dryRun: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dryRun: true, scanned: 30, wouldDelete: 2, orphansDeleted: 0, stopReason: null });
    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(eventOf("storage.orphans_deleted")).toBeUndefined();
  });

  it("reports a stop reason without alerting", async () => {
    mockMarker.checkStorageMarker.mockResolvedValue({ ok: false, problem: "marker_not_set_up" });
    mockListObjects.mockResolvedValue(oldOrphans(2));
    const res = await cleanup(request({ dryRun: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).stopReason).toBe("marker_not_set_up");
    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(eventOf("storage.cleanup_stopped")).toBeUndefined();
  });
});

describe("public-log safety (the scheduled caller's log is public)", () => {
  const FILE_NAME = "Q3-salary-review-ACME.pdf";

  it("returns counts only: no object keys and no file names in the response", async () => {
    mockListObjects.mockResolvedValue([
      { key: `attachments/issue1/uuid-a-${FILE_NAME}`, lastModified: OLD, size: 10 },
      ...oldAttached(19),
    ]);
    for (const dryRun of [false, true]) {
      const res = await cleanup(request({ dryRun }));
      const text = await res.text();
      expect(text).not.toContain(FILE_NAME);
      expect(text).not.toContain("attachments/");
      expect(Object.keys(JSON.parse(text)).sort()).toEqual(
        ["candidates", "dryRun", "orphansDeleted", "scanned", "stopReason", "wouldDelete"]
      );
    }
  });

  it("records what it deleted server-side by issue id, without file names", async () => {
    mockListObjects.mockResolvedValue([
      { key: `attachments/issue1/uuid-a-${FILE_NAME}`, lastModified: OLD, size: 10 },
      { key: "attachments/issue1/uuid-b-notes.txt", lastModified: OLD, size: 10 },
      { key: "attachments/issue2/uuid-c-photo.png", lastModified: OLD, size: 10 },
      ...oldAttached(30),
    ]);
    await cleanup(request());
    expect(eventOf("storage.orphans_deleted")?.meta).toMatchObject({ orphansDeleted: 3, perIssue: { issue1: 2, issue2: 1 } });
    for (const c of warn.mock.calls) {
      expect(String(c[0])).not.toContain(FILE_NAME);
      expect(String(c[0])).not.toContain("photo.png");
    }
  });

  it("a stop record carries counts and the reason, never file names", async () => {
    mockMarker.checkStorageMarker.mockResolvedValue({ ok: false, problem: "marker_mismatch" });
    mockListObjects.mockResolvedValue([{ key: `attachments/issue1/uuid-a-${FILE_NAME}`, lastModified: OLD, size: 10 }]);
    await cleanup(request());
    for (const c of warn.mock.calls) expect(String(c[0])).not.toContain(FILE_NAME);
  });

  it("emits no deletion record when nothing was deleted", async () => {
    mockListObjects.mockResolvedValue(oldAttached(1));
    await cleanup(request());
    expect(eventOf("storage.orphans_deleted")).toBeUndefined();
  });
});
