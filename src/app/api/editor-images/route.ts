import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { auth } from "@/lib/auth";
import { putObject, getPresignedDownloadUrl } from "@/lib/s3";

const MAX_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Not an image" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Decode-validate rather than trusting the declared Content-Type (SECH-90,
  // consistent with the avatar route's SECH-88 fix). Unlike the avatar route,
  // this does not re-encode: editor images can be animated GIF/WebP or need
  // to preserve exact pixel data, so the original bytes are stored once
  // confirmed to be a real, decodable image.
  try {
    await sharp(buffer).metadata();
  } catch {
    return NextResponse.json({ error: "Invalid or unsupported image file" }, { status: 400 });
  }

  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : ".png";
  const key = `editor-images/${crypto.randomUUID()}${ext}`;
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
    const url = await getPresignedDownloadUrl(key);
    return NextResponse.redirect(url, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
