import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getPresignedDownloadUrl, putObject } from "@/lib/s3";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5 MB

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentLength = Number(request.headers.get("content-length"));
  if (!contentLength || Number.isNaN(contentLength)) {
    return NextResponse.json({ error: "Content-Length header required" }, { status: 411 });
  }
  if (contentLength > MAX_AVATAR_SIZE) {
    return NextResponse.json({ error: "File exceeds 5 MB limit" }, { status: 413 });
  }

  const rawBuffer = Buffer.from(await request.arrayBuffer());
  if (rawBuffer.length > MAX_AVATAR_SIZE) {
    return NextResponse.json({ error: "File exceeds 5 MB limit" }, { status: 413 });
  }

  // Decode and re-encode server-side rather than trusting the declared Content-Type:
  // this both rejects anything that isn't a real raster image and strips embedded
  // metadata (EXIF/GPS) as a side effect of re-encoding to a clean JPEG.
  let buffer: Buffer;
  try {
    buffer = await sharp(rawBuffer)
      .resize(256, 256, { fit: "cover" })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "Invalid or unsupported image file" }, { status: 400 });
  }

  const key = `avatars/${session.user.id}.jpg`;

  await putObject(key, buffer, "image/jpeg");

  const avatarUrl = `/api/avatar?key=${key}`;
  await prisma.user.update({ where: { id: session.user.id }, data: { avatarUrl } });

  return NextResponse.json({ avatarUrl });
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const key = request.nextUrl.searchParams.get("key");
  if (!key || !key.startsWith("avatars/")) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  try {
    const url = await getPresignedDownloadUrl(key);
    return NextResponse.redirect(url, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
