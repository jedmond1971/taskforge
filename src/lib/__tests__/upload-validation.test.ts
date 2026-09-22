import { describe, it, expect, beforeAll } from "vitest";
import sharp from "sharp";
import {
  isAllowedAttachmentMimeType,
  isAllowedImageMimeType,
  sniffRasterFormat,
  validateRasterImage,
} from "@/lib/upload-validation";

// SECH-125: attachments/editor images must be real raster images; SVG (an active
// document that sharp happily decodes) is rejected before it reaches a decoder.
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>'
);

const images: Record<string, Buffer> = {};
beforeAll(async () => {
  const base = sharp({ create: { width: 4, height: 4, channels: 3, background: "#f00" } });
  images.png = await base.clone().png().toBuffer();
  images.jpeg = await base.clone().jpeg().toBuffer();
  images.gif = await base.clone().gif().toBuffer();
  images.webp = await base.clone().webp().toBuffer();
});

describe("image mime allowlist", () => {
  it("allows only raster image types", () => {
    for (const t of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
      expect(isAllowedImageMimeType(t)).toBe(true);
      expect(isAllowedAttachmentMimeType(t)).toBe(true);
    }
    for (const t of ["image/svg+xml", "image/x-icon", "image/bmp", "image/tiff", "image/heic", "image/"]) {
      expect(isAllowedImageMimeType(t)).toBe(false);
      expect(isAllowedAttachmentMimeType(t)).toBe(false);
    }
  });

  it("still allows the non-image document types", () => {
    expect(isAllowedAttachmentMimeType("application/pdf")).toBe(true);
    expect(isAllowedAttachmentMimeType("text/html")).toBe(false);
  });
});

describe("sniffRasterFormat", () => {
  it("identifies each raster format by magic bytes", () => {
    for (const f of ["png", "jpeg", "gif", "webp"]) expect(sniffRasterFormat(images[f])).toBe(f);
  });

  it("returns null for SVG, text and empty input", () => {
    expect(sniffRasterFormat(SVG)).toBeNull();
    expect(sniffRasterFormat(Buffer.from("hello"))).toBeNull();
    expect(sniffRasterFormat(Buffer.alloc(0))).toBeNull();
  });
});

describe("validateRasterImage", () => {
  it("accepts a real image of the declared type", async () => {
    expect(await validateRasterImage(images.png, "image/png")).toBe(true);
    expect(await validateRasterImage(images.jpeg, "image/jpeg")).toBe(true);
    expect(await validateRasterImage(images.gif, "image/gif")).toBe(true);
    expect(await validateRasterImage(images.webp, "image/webp")).toBe(true);
  });

  it("rejects SVG whatever it is declared as", async () => {
    expect(await validateRasterImage(SVG, "image/svg+xml")).toBe(false);
    expect(await validateRasterImage(SVG, "image/png")).toBe(false);
    expect(await validateRasterImage(SVG)).toBe(false);
  });

  it("rejects a real image declared as a different type", async () => {
    expect(await validateRasterImage(images.png, "image/jpeg")).toBe(false);
  });

  it("rejects raster magic bytes followed by garbage", async () => {
    const fake = Buffer.concat([images.png.subarray(0, 8), Buffer.from("not really a png")]);
    expect(await validateRasterImage(fake, "image/png")).toBe(false);
  });
});
