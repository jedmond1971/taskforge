import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockPrisma, mockAuthFn, mockPutObject } = vi.hoisted(() => {
  const mockPrisma = {
    user: { update: vi.fn().mockResolvedValue({}) },
  };
  const mockAuthFn = vi.fn();
  const mockPutObject = vi.fn().mockResolvedValue(undefined);
  return { mockPrisma, mockAuthFn, mockPutObject };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: mockAuthFn }));
vi.mock("@/lib/s3", () => ({
  putObject: mockPutObject,
  getPresignedDownloadUrl: vi.fn(),
}));

import { NextRequest } from "next/server";
import { PUT } from "@/app/api/avatar/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requestWithBuffer(body: Buffer): NextRequest {
  // Real HTTP clients (browser fetch, curl) set Content-Length automatically
  // when sending a Buffer/Blob body; undici's in-process Request constructor
  // does not, so it must be set explicitly to simulate a real request here.
  return new NextRequest("http://localhost/api/avatar", {
    method: "PUT",
    headers: { "content-type": "image/jpeg", "content-length": String(body.length) },
    body: new Uint8Array(body),
  });
}

function requestWithStreamingBody(): NextRequest {
  // A ReadableStream body has no automatically-computed Content-Length header,
  // simulating a client that omits it.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  return new NextRequest("http://localhost/api/avatar", {
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
    body: stream,
    duplex: "half",
  });
}

async function makeRealJpegWithExif(): Promise<Buffer> {
  const base = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 100, g: 150, b: 200 } },
  })
    .jpeg()
    .toBuffer();

  // Embed EXIF metadata so we can assert it does NOT survive the route's
  // decode/re-encode step.
  return sharp(base)
    .withMetadata({ exif: { IFD0: { Copyright: "sensitive-location-data" } } })
    .jpeg()
    .toBuffer();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthFn.mockResolvedValue({ user: { id: "user-1" } });
  mockPrisma.user.update.mockResolvedValue({});
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PUT /api/avatar", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuthFn.mockResolvedValue(null);
    const res = await PUT(requestWithBuffer(Buffer.from("irrelevant")));
    expect(res.status).toBe(401);
  });

  it("returns 411 when Content-Length is missing", async () => {
    const res = await PUT(requestWithStreamingBody());
    expect(res.status).toBe(411);
  });

  it("returns 413 and never decodes when the body exceeds the 5 MB limit", async () => {
    const oversized = Buffer.alloc(6 * 1024 * 1024, 1);
    const res = await PUT(requestWithBuffer(oversized));
    expect(res.status).toBe(413);
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  it("returns 400 for bytes that are not a real image, regardless of declared Content-Type", async () => {
    const notAnImage = Buffer.from("<script>alert(1)</script>".repeat(50));
    const res = await PUT(requestWithBuffer(notAnImage));
    expect(res.status).toBe(400);
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  it("accepts a real image, re-encodes it, and strips embedded EXIF metadata", async () => {
    const withExif = await makeRealJpegWithExif();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const res = await PUT(requestWithBuffer(withExif));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.avatarUrl).toBe("/api/avatar?key=avatars/user-1.jpg");

    expect(mockPutObject).toHaveBeenCalledTimes(1);
    const [key, storedBuffer, mimeType] = mockPutObject.mock.calls[0];
    expect(key).toBe("avatars/user-1.jpg");
    expect(mimeType).toBe("image/jpeg");

    const storedMeta = await sharp(storedBuffer).metadata();
    expect(storedMeta.exif).toBeUndefined();
    expect(storedMeta.width).toBe(256);
    expect(storedMeta.height).toBe(256);

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { avatarUrl: "/api/avatar?key=avatars/user-1.jpg" },
    });
  });
});
