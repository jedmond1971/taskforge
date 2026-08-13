import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getObjectBuffer } from "@/lib/s3";
import { resolveDocCtx } from "@/app/api/docs/_helpers";

// GET /api/docs/[projectKey]/pages/[pageId]/images/[imageKey] — proxy an
// image extracted from a DOCX preview conversion. Never serves a raw S3 URL
// (those are presigned and expire) and never an arbitrary S3 key — only
// objects under this page's own docx-images/ prefix.
export async function GET(
  _req: NextRequest,
  { params }: { params: { projectKey: string; pageId: string; imageKey: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ctx = await resolveDocCtx(params.projectKey, session.user.id);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const page = await prisma.docPage.findFirst({
      where: { id: params.pageId, docSpaceId: ctx.docSpaceId },
    });
    if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const key = decodeURIComponent(params.imageKey);
    const expectedPrefix = `docs/${page.docSpaceId}/${page.id}/docx-images/`;
    if (!key.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let buffer: Buffer;
    try {
      buffer = await getObjectBuffer(key);
    } catch (error) {
      if (error instanceof Error && error.name === "NoSuchKey") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      throw error;
    }

    const ext = key.split(".").pop()?.toLowerCase();
    const contentType =
      ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
      ext === "gif" ? "image/gif" :
      ext === "webp" ? "image/webp" : "image/png";

    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" },
    });
  } catch (error) {
    console.error("GET docx image proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
