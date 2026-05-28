import { NextRequest, NextResponse } from "next/server";
import { getPresignedDownloadUrl, putObject } from "@/lib/s3";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = request.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "Invalid content type" }, { status: 400 });
  }

  const buffer = Buffer.from(await request.arrayBuffer());
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
