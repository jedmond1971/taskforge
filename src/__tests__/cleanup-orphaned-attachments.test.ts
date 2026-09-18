import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockListObjects, mockDeleteObjects, mockRateLimit } = vi.hoisted(() => ({
  mockPrisma: { attachment: { findMany: vi.fn() } },
  mockListObjects: vi.fn(),
  mockDeleteObjects: vi.fn().mockResolvedValue(undefined),
  mockRateLimit: {
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
    recordFailure: vi.fn(),
    getClientIp: vi.fn().mockReturnValue("203.0.113.5"),
    logAuthFailure: vi.fn(),
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
    expect(body.deletedKeys).toEqual(["attachments/i1/orphan.pdf"]);
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
});
