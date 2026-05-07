import { NextRequest, NextResponse } from "next/server";
import { getPresignedDownloadUrl } from "@/lib/s3";

export async function GET(request: NextRequest) {
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
