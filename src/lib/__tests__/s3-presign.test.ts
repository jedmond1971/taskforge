import { describe, it, expect, beforeAll } from "vitest";

// SECH-125: the response-* overrides must be inside the signed query string of the
// real presigned URL (signing is offline — no network or real credentials needed).
let getPresignedDownloadUrl: typeof import("@/lib/s3").getPresignedDownloadUrl;
beforeAll(async () => {
  process.env.RAILWAY_BUCKET_ENDPOINT = "https://bucket.example.test";
  process.env.RAILWAY_BUCKET_REGION = "auto";
  process.env.RAILWAY_BUCKET_ACCESS_KEY_ID = "AKIDEXAMPLE";
  process.env.RAILWAY_BUCKET_SECRET_ACCESS_KEY = "test-secret";
  process.env.RAILWAY_BUCKET_NAME = "test-bucket";
  ({ getPresignedDownloadUrl } = await import("@/lib/s3"));
});

describe("getPresignedDownloadUrl", () => {
  it("signs an attachment disposition for an SVG", async () => {
    const u = new URL(await getPresignedDownloadUrl("attachments/i/x.svg", { contentType: "image/svg+xml", fileName: "x.svg" }));
    expect(u.searchParams.get("response-content-type")).toBe("application/octet-stream");
    expect(u.searchParams.get("response-content-disposition")).toMatch(/^attachment; filename="x\.svg"/);
    expect(u.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("signs an inline disposition with a pinned type for a PNG", async () => {
    const u = new URL(await getPresignedDownloadUrl("attachments/i/p.png", { contentType: "image/png", fileName: "p.png" }));
    expect(u.searchParams.get("response-content-type")).toBe("image/png");
    expect(u.searchParams.get("response-content-disposition")).toMatch(/^inline;/);
  });

  it("defaults to a download when the caller gives no type", async () => {
    const u = new URL(await getPresignedDownloadUrl("editor-images/legacy.svg"));
    expect(u.searchParams.get("response-content-disposition")).toMatch(/^attachment; filename="legacy\.svg"/);
  });
});
