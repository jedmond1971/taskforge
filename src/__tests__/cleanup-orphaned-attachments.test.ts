import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPrisma, mockListObjects, mockDeleteObjects, mockRateLimit } = vi.hoisted(() => ({
  mockPrisma: { attachment: { findMany: vi.fn() } },
  mockListObjects: vi.fn(),
  mockDeleteObjects: vi.fn().mockResolvedValue(undefined),
  mockRateLimit: {
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
    recordFailure: vi.fn(),
    getClientIp: vi.fn().mockReturnValue("203.0.113.5"),
    V1_API_RATE_LIMIT: { maxAttempts: 10, windowMs: 15 * 60 * 1000 },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/s3", () => ({
  listObjects: mockListObjects,
  deleteObjects: mockDeleteObjects,
}));
vi.mock("@/lib/rate-limit", () => mockRateLimit);

import { NextRequest } from "next/server";
import { POST as cleanup } from "@/app/api/internal/cleanup-orphaned-attachments/route";

const OLD = new Date(Date.now() - 48 * 60 * 60 * 1000); // 2 days old
const RECENT = new Date(Date.now() - 60 * 1000); // 1 minute old

function request(headers: Record<string, string> = { "X-Internal-Api-Key": "test-key" }): NextRequest {
  return new NextRequest("http://localhost/api/internal/cleanup-orphaned-attachments", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.V1_API_KEY = "test-key";
  mockPrisma.attachment.findMany.mockResolvedValue([]);
});

describe("POST /api/internal/cleanup-orphaned-attachments", () => {
  it("returns 401 without the internal API key", async () => {
    const res = await cleanup(request({}));
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
    mockListObjects.mockResolvedValue([
      { key: "attachments/i1/orphan.pdf", lastModified: OLD, size: 10 },
      { key: "attachments/i1/confirmed.pdf", lastModified: OLD, size: 20 },
    ]);
    mockPrisma.attachment.findMany.mockResolvedValue([{ fileKey: "attachments/i1/confirmed.pdf" }]);

    const res = await cleanup(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scanned).toBe(2);
    expect(body.candidates).toBe(2);
    expect(body.orphansDeleted).toBe(1);
    expect(mockDeleteObjects).toHaveBeenCalledWith(["attachments/i1/orphan.pdf"]);
  });

  it("does not call deleteObjects when every old object still has a row", async () => {
    mockListObjects.mockResolvedValue([{ key: "attachments/i1/confirmed.pdf", lastModified: OLD, size: 20 }]);
    mockPrisma.attachment.findMany.mockResolvedValue([{ fileKey: "attachments/i1/confirmed.pdf" }]);

    const res = await cleanup(request());
    const body = await res.json();
    expect(body.orphansDeleted).toBe(0);
    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  describe("public-log safety (the scheduled caller's log is public)", () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    const FILE_NAME = "Q3-salary-review-ACME.pdf";

    it("returns counts only: no object keys and no file names in the response", async () => {
      mockListObjects.mockResolvedValue([
        { key: `attachments/issue1/uuid-a-${FILE_NAME}`, lastModified: OLD, size: 10 },
      ]);

      const res = await cleanup(request());
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(FILE_NAME);
      expect(text).not.toContain("attachments/");
      expect(Object.keys(JSON.parse(text)).sort()).toEqual(["candidates", "orphansDeleted", "scanned"]);
    });

    it("records what it deleted server-side by issue id, without file names", async () => {
      mockListObjects.mockResolvedValue([
        { key: `attachments/issue1/uuid-a-${FILE_NAME}`, lastModified: OLD, size: 10 },
        { key: "attachments/issue1/uuid-b-notes.txt", lastModified: OLD, size: 10 },
        { key: "attachments/issue2/uuid-c-photo.png", lastModified: OLD, size: 10 },
      ]);

      await cleanup(request());

      const lines = warn.mock.calls.map((c) => String(c[0]));
      const event = lines.map((l) => JSON.parse(l)).find((r) => r.type === "storage.orphans_deleted");
      expect(event).toBeDefined();
      expect(event.meta).toMatchObject({ orphansDeleted: 3, perIssue: { issue1: 2, issue2: 1 } });
      for (const line of lines) {
        expect(line).not.toContain(FILE_NAME);
        expect(line).not.toContain("photo.png");
      }
    });

    it("emits no deletion record when nothing was deleted", async () => {
      mockListObjects.mockResolvedValue([{ key: "attachments/i1/confirmed.pdf", lastModified: OLD, size: 20 }]);
      mockPrisma.attachment.findMany.mockResolvedValue([{ fileKey: "attachments/i1/confirmed.pdf" }]);

      await cleanup(request());
      expect(warn.mock.calls.some((c) => String(c[0]).includes("storage.orphans_deleted"))).toBe(false);
    });
  });

  it("only scans the attachments/ prefix and never deletes an object outside it", async () => {
    mockListObjects.mockResolvedValue([
      { key: "attachments/i1/orphan.pdf", lastModified: OLD, size: 10 },
      // Defensive: even if a listing ever returned other prefixes, they are not touched.
      { key: "editor-images/abc.png", lastModified: OLD, size: 10 },
      { key: "docs/space/page/file.docx", lastModified: OLD, size: 10 },
      { key: "avatars/user1.jpg", lastModified: OLD, size: 10 },
    ]);

    const res = await cleanup(request());
    expect(res.status).toBe(200);
    expect(mockListObjects).toHaveBeenCalledWith("attachments/");
    expect(mockDeleteObjects).toHaveBeenCalledTimes(1);
    expect(mockDeleteObjects).toHaveBeenCalledWith(["attachments/i1/orphan.pdf"]);
    expect((await res.json()).scanned).toBe(1);
  });

  it("deletes nothing when the Attachment lookup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockListObjects.mockResolvedValue([{ key: "attachments/i1/maybe-attached.pdf", lastModified: OLD, size: 10 }]);
    mockPrisma.attachment.findMany.mockRejectedValue(new Error("connection refused"));

    const res = await cleanup(request());
    expect(res.status).toBe(500);
    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(await res.text()).not.toContain("maybe-attached.pdf");
    warn.mockRestore();
  });
});
