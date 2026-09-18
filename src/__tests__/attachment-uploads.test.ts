import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockPrisma,
  mockAuthFn,
  mockGetPresignedUploadUrl,
  mockGetPresignedDownloadUrl,
  mockHeadObjectSize,
  mockGetObjectBuffer,
  mockDeleteObject,
  mockPutObject,
} = vi.hoisted(() => ({
  mockPrisma: {
    issue: { findUnique: vi.fn() },
    projectMember: { findUnique: vi.fn() },
    attachment: { create: vi.fn() },
    activityLog: { create: vi.fn().mockResolvedValue({}) },
  },
  mockAuthFn: vi.fn(),
  mockGetPresignedUploadUrl: vi.fn().mockResolvedValue("https://s3.example/upload"),
  mockGetPresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example/download"),
  mockHeadObjectSize: vi.fn(),
  mockGetObjectBuffer: vi.fn(),
  mockDeleteObject: vi.fn().mockResolvedValue(undefined),
  mockPutObject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: mockAuthFn }));
vi.mock("@/lib/s3", () => ({
  getPresignedUploadUrl: mockGetPresignedUploadUrl,
  getPresignedDownloadUrl: mockGetPresignedDownloadUrl,
  headObjectSize: mockHeadObjectSize,
  getObjectBuffer: mockGetObjectBuffer,
  deleteObject: mockDeleteObject,
  putObject: mockPutObject,
}));

import { NextRequest } from "next/server";
import { POST as presign } from "@/app/api/attachments/presign/route";
import { POST as confirm } from "@/app/api/attachments/confirm/route";
import { POST as directUpload } from "@/app/api/attachments/upload/route";
import { POST as editorImagesUpload } from "@/app/api/editor-images/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function realJpegBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .jpeg()
    .toBuffer();
}

function formDataRequest(url: string, file: File, fields: Record<string, string> = {}): NextRequest {
  const fd = new FormData();
  fd.set("file", file);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new NextRequest(`http://localhost${url}`, { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthFn.mockResolvedValue({ user: { id: "user-1" } });
  mockGetPresignedUploadUrl.mockResolvedValue("https://s3.example/upload");
  mockGetPresignedDownloadUrl.mockResolvedValue("https://s3.example/download");
  mockPrisma.issue.findUnique.mockResolvedValue({ projectId: "proj-1" });
  mockPrisma.projectMember.findUnique.mockResolvedValue({ role: "TEAM_MEMBER" });
  mockPrisma.attachment.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "att-1", createdAt: new Date(), uploader: { id: "user-1", name: "Alice" }, ...data })
  );
});

// ─── POST /api/attachments/presign ─────────────────────────────────────────────

describe("POST /api/attachments/presign", () => {
  it("does not create an Attachment row (deferred to confirm)", async () => {
    const res = await presign(
      jsonRequest("/api/attachments/presign", {
        issueId: "issue-1",
        fileName: "report.pdf",
        fileSize: 1000,
        mimeType: "application/pdf",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).toBe("https://s3.example/upload");
    expect(body.key).toMatch(/^attachments\/issue-1\//);
    expect(body.attachmentId).toBeUndefined();
    expect(mockPrisma.attachment.create).not.toHaveBeenCalled();
  });

  it("rejects a disallowed mime type", async () => {
    const res = await presign(
      jsonRequest("/api/attachments/presign", {
        issueId: "issue-1",
        fileName: "app.exe",
        fileSize: 1000,
        mimeType: "application/x-msdownload",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a non-member", async () => {
    mockPrisma.projectMember.findUnique.mockResolvedValue(null);
    const res = await presign(
      jsonRequest("/api/attachments/presign", {
        issueId: "issue-1",
        fileName: "report.pdf",
        fileSize: 1000,
        mimeType: "application/pdf",
      })
    );
    expect(res.status).toBe(403);
  });
});

// ─── POST /api/attachments/confirm ─────────────────────────────────────────────

describe("POST /api/attachments/confirm", () => {
  const validBody = {
    issueId: "issue-1",
    fileKey: "attachments/issue-1/uuid-report.pdf",
    fileName: "report.pdf",
    fileSize: 1000,
    mimeType: "application/pdf",
  };

  it("rejects a fileKey that doesn't belong to the claimed issue", async () => {
    const res = await confirm(
      jsonRequest("/api/attachments/confirm", { ...validBody, fileKey: "attachments/other-issue/x.pdf" })
    );
    expect(res.status).toBe(400);
    expect(mockHeadObjectSize).not.toHaveBeenCalled();
  });

  it("returns 409 when the object was never actually uploaded", async () => {
    mockHeadObjectSize.mockResolvedValue(null);
    const res = await confirm(jsonRequest("/api/attachments/confirm", validBody));
    expect(res.status).toBe(409);
    expect(mockPrisma.attachment.create).not.toHaveBeenCalled();
  });

  it("rejects and deletes the object when the real S3 size differs from the declared size", async () => {
    mockHeadObjectSize.mockResolvedValue(999); // declared 1000
    const res = await confirm(jsonRequest("/api/attachments/confirm", validBody));
    expect(res.status).toBe(400);
    expect(mockDeleteObject).toHaveBeenCalledWith(validBody.fileKey);
    expect(mockPrisma.attachment.create).not.toHaveBeenCalled();
  });

  it("rejects and deletes the object when a declared image fails to decode", async () => {
    const notAnImage = Buffer.from("not a real image");
    mockHeadObjectSize.mockResolvedValue(notAnImage.length);
    mockGetObjectBuffer.mockResolvedValue(notAnImage);
    const res = await confirm(
      jsonRequest("/api/attachments/confirm", {
        ...validBody,
        fileKey: "attachments/issue-1/uuid-photo.jpg",
        fileSize: notAnImage.length,
        mimeType: "image/jpeg",
      })
    );
    expect(res.status).toBe(400);
    expect(mockDeleteObject).toHaveBeenCalled();
    expect(mockPrisma.attachment.create).not.toHaveBeenCalled();
  });

  it("creates the Attachment row once the real object checks out", async () => {
    mockHeadObjectSize.mockResolvedValue(1000);
    const res = await confirm(jsonRequest("/api/attachments/confirm", validBody));
    expect(res.status).toBe(200);
    expect(mockPrisma.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ issueId: "issue-1", fileKey: validBody.fileKey, fileSize: 1000 }),
      })
    );
    expect(mockPrisma.activityLog.create).toHaveBeenCalled();
    const body = await res.json();
    expect(body.attachment.downloadUrl).toBe("https://s3.example/download");
  });

  it("accepts a real, decodable image whose size matches", async () => {
    const jpeg = await realJpegBuffer();
    mockHeadObjectSize.mockResolvedValue(jpeg.length);
    mockGetObjectBuffer.mockResolvedValue(jpeg);
    const res = await confirm(
      jsonRequest("/api/attachments/confirm", {
        issueId: "issue-1",
        fileKey: "attachments/issue-1/uuid-photo.jpg",
        fileName: "photo.jpg",
        fileSize: jpeg.length,
        mimeType: "image/jpeg",
      })
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.attachment.create).toHaveBeenCalled();
  });
});

// ─── POST /api/attachments/upload (direct multipart) ───────────────────────────

describe("POST /api/attachments/upload", () => {
  it("rejects an image/* file whose bytes don't decode as a real image", async () => {
    const fakeImage = new File([Buffer.from("<script>alert(1)</script>")], "x.png", { type: "image/png" });
    const res = await directUpload(formDataRequest("/api/attachments/upload", fakeImage, { issueId: "issue-1" }));
    expect(res.status).toBe(400);
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  it("accepts a real image", async () => {
    const jpeg = await realJpegBuffer();
    const realImage = new File([new Uint8Array(jpeg)], "photo.jpg", { type: "image/jpeg" });
    const res = await directUpload(formDataRequest("/api/attachments/upload", realImage, { issueId: "issue-1" }));
    expect(res.status).toBe(200);
    expect(mockPutObject).toHaveBeenCalledTimes(1);
  });

  it("accepts a non-image allow-listed file without running image validation", async () => {
    const pdf = new File([Buffer.from("%PDF-1.4 fake pdf bytes")], "doc.pdf", { type: "application/pdf" });
    const res = await directUpload(formDataRequest("/api/attachments/upload", pdf, { issueId: "issue-1" }));
    expect(res.status).toBe(200);
    expect(mockPutObject).toHaveBeenCalledTimes(1);
  });
});

// ─── POST /api/editor-images ────────────────────────────────────────────────────

describe("POST /api/editor-images", () => {
  it("rejects bytes that are not a real image despite an image/* Content-Type", async () => {
    const fakeImage = new File([Buffer.from("<script>alert(1)</script>")], "x.png", { type: "image/png" });
    const res = await editorImagesUpload(formDataRequest("/api/editor-images", fakeImage));
    expect(res.status).toBe(400);
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  it("accepts a real image", async () => {
    const jpeg = await realJpegBuffer();
    const realImage = new File([new Uint8Array(jpeg)], "photo.jpg", { type: "image/jpeg" });
    const res = await editorImagesUpload(formDataRequest("/api/editor-images", realImage));
    expect(res.status).toBe(200);
    expect(mockPutObject).toHaveBeenCalledTimes(1);
  });
});
