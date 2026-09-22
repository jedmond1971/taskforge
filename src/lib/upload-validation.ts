import sharp from "sharp";

export const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024; // 20 MB

// Allowlist (not blocklist) so a new/unusual mime type is rejected by default
// rather than silently permitted. Kept in one place so the direct-upload path
// (attachments/upload) and the presigned path (attachments/presign) can't
// drift apart on what they consider a safe attachment.
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/x-zip-compressed",
]);

// SECH-125: raster formats only. SVG is an active document (it can carry <script>)
// and sharp *does* decode it, so "decodes as an image" is not a safety check on its own.
const RASTER_IMAGE_FORMATS: Record<string, RasterFormat> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
};

type RasterFormat = "png" | "jpeg" | "gif" | "webp";

export function isAllowedImageMimeType(mimeType: string): boolean {
  return mimeType in RASTER_IMAGE_FORMATS;
}

export function isAllowedAttachmentMimeType(mimeType: string): boolean {
  return isAllowedImageMimeType(mimeType) || ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType);
}

/** Identify a raster image by its magic bytes, without handing the bytes to a decoder. */
export function sniffRasterFormat(buffer: Buffer): RasterFormat | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString("latin1"))) return "gif";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

/**
 * True only for a real, decodable PNG/JPEG/GIF/WebP. The magic-byte check runs first so
 * non-raster input (notably SVG, whose decoder can resolve external references) never
 * reaches sharp. If `declaredMimeType` is given, the real format must match it.
 */
export async function validateRasterImage(buffer: Buffer, declaredMimeType?: string): Promise<boolean> {
  const sniffed = sniffRasterFormat(buffer);
  if (!sniffed) return false;
  if (declaredMimeType !== undefined && RASTER_IMAGE_FORMATS[declaredMimeType] !== sniffed) return false;
  try {
    const { format } = await sharp(buffer).metadata();
    return format === sniffed;
  } catch {
    return false;
  }
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
