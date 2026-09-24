import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { putObject, getPresignedDownloadUrl } from "@/lib/s3";
import { isAllowedImageMimeType, sniffRasterFormat, validateRasterImage } from "@/lib/upload-validation";
import { securityEvent } from "@/lib/security-events";
import { requestIdFromHeaders } from "@/lib/request-id";

const FORMAT_EXT = { png: ".png", jpeg: ".jpg", gif: ".gif", webp: ".webp" } as const;
const EXT_TYPE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requestId = requestIdFromHeaders(request.headers);
  const userId = session.user.id;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!isAllowedImageMimeType(file.type)) {
    securityEvent("upload.rejected", {
      requestId,
      userId,
      meta: { reason: "mime_type", declaredType: file.type, route: "editor-images" },
    });
    return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    securityEvent("upload.rejected", {
      requestId,
      userId,
      meta: { reason: "size", fileSize: file.size, route: "editor-images" },
    });
    return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Decode-validate rather than trusting the declared Content-Type (SECH-90,
  // consistent with the avatar route's SECH-88 fix), and raster-only — never
  // SVG (SECH-125). Unlike the avatar route this does not re-encode: editor
  // images can be animated GIF/WebP, so the original bytes are stored once
  // confirmed to be a real image of the declared type.
  if (!(await validateRasterImage(buffer, file.type))) {
    securityEvent("upload.rejected", {
      requestId,
      userId,
      meta: { reason: "not_raster_image", declaredType: file.type, route: "editor-images" },
    });
    return NextResponse.json({ error: "Invalid or unsupported image file" }, { status: 400 });
  }

  // Extension from the verified format, not the client's file name.
  const key = `editor-images/${crypto.randomUUID()}${FORMAT_EXT[sniffRasterFormat(buffer)!]}`;
  await putObject(key, buffer, file.type);

  const url = `/api/editor-images?key=${encodeURIComponent(key)}`;
  return NextResponse.json({ url });
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = request.nextUrl.searchParams.get("key");
  if (!key || !key.startsWith("editor-images/")) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  try {
    // Pre-SECH-125 keys used the client's extension; anything that isn't a
    // known raster extension is served as a download, never inline.
    const ext = key.includes(".") ? key.slice(key.lastIndexOf(".")).toLowerCase() : "";
    const url = await getPresignedDownloadUrl(key, { contentType: EXT_TYPE[ext] });
    return NextResponse.redirect(url, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
