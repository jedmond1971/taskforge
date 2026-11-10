import { describe, it, expect, vi, afterEach } from "vitest";
import { clientIpFromHeaders } from "@/lib/rate-limit";

// Self-hosted deployment (Proxmox behind a Cloudflare Tunnel): the two behaviours that differ from
// Railway are which header names the client, and which hostname presigned URLs are signed for.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("clientIpFromHeaders behind Cloudflare", () => {
  const spoofed = new Headers({
    // Cloudflare appends the real IP to whatever the client sent, so the spoof is first.
    "x-forwarded-for": "6.6.6.6, 203.0.113.9",
    "cf-connecting-ip": "203.0.113.9",
  });

  it("ignores CF-Connecting-IP unless TRUSTED_PROXY=cloudflare (Railway behaviour unchanged)", () => {
    expect(clientIpFromHeaders(spoofed)).toBe("6.6.6.6");
  });

  it("uses CF-Connecting-IP, not the spoofable leftmost XFF entry, when trusted", () => {
    vi.stubEnv("TRUSTED_PROXY", "cloudflare");
    expect(clientIpFromHeaders(spoofed)).toBe("203.0.113.9");
  });

  it("falls back to X-Forwarded-For when the header is absent", () => {
    vi.stubEnv("TRUSTED_PROXY", "cloudflare");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
  });
});

describe("presigned URLs with a separate public storage endpoint", () => {
  async function load(env: Record<string, string>) {
    vi.stubEnv("RAILWAY_BUCKET_ENDPOINT", "http://minio:9000");
    vi.stubEnv("RAILWAY_BUCKET_REGION", "us-east-1");
    vi.stubEnv("RAILWAY_BUCKET_ACCESS_KEY_ID", "AKIDEXAMPLE");
    vi.stubEnv("RAILWAY_BUCKET_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("RAILWAY_BUCKET_NAME", "jedforge");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    return import("@/lib/s3");
  }

  it("signs for the public hostname, path-style, so the browser can use the URL", async () => {
    const s3 = await load({ S3_PUBLIC_ENDPOINT: "https://files.example.test", S3_FORCE_PATH_STYLE: "true" });
    const u = new URL(await s3.getPresignedUploadUrl("attachments/i/a.png", "image/png", 10));
    expect(u.origin).toBe("https://files.example.test");
    expect(u.pathname).toBe("/jedforge/attachments/i/a.png");
    expect(u.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("does not put an empty-body checksum in the presigned PUT (Garage/MinIO reject it)", async () => {
    const s3 = await load({ S3_PUBLIC_ENDPOINT: "https://files.example.test", S3_FORCE_PATH_STYLE: "true" });
    const u = new URL(await s3.getPresignedUploadUrl("attachments/i/a.png", "image/png", 10));
    expect(u.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(u.searchParams.has("x-amz-sdk-checksum-algorithm")).toBe(false);
  });

  it("keeps using the single configured endpoint when no public endpoint is set", async () => {
    const s3 = await load({ RAILWAY_BUCKET_ENDPOINT: "https://bucket.example.test" });
    const u = new URL(await s3.getPresignedDownloadUrl("attachments/i/a.png", { contentType: "image/png" }));
    expect(u.hostname).toBe("jedforge.bucket.example.test");
  });
});
