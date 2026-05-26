import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveDocCtx } from "@/app/api/docs/_helpers";

const MAX_RESULTS = 20;

// GET /api/docs/[projectKey]/search?q=<query>
export async function GET(
  req: NextRequest,
  { params }: { params: { projectKey: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ctx = await resolveDocCtx(params.projectKey, session.user.id);
    if (!ctx) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (!q) return NextResponse.json({ results: [] });

    const pages = await prisma.docPage.findMany({
      where: {
        docSpaceId: ctx.docSpaceId,
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { type: "NATIVE", content: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        title: true,
        type: true,
        content: true,
        section: { select: { id: true, title: true } },
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_RESULTS,
    });

    const results = pages.map((page) => {
      let snippet: string | null = null;
      if (page.type === "NATIVE" && page.content) {
        // Strip HTML tags and find the matching excerpt
        const text = page.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const idx = text.toLowerCase().indexOf(q.toLowerCase());
        if (idx !== -1) {
          const start = Math.max(0, idx - 60);
          const end = Math.min(text.length, idx + q.length + 60);
          snippet = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
        } else {
          snippet = text.slice(0, 120) + (text.length > 120 ? "…" : "");
        }
      }
      return {
        id: page.id,
        title: page.title,
        type: page.type,
        sectionId: page.section?.id ?? null,
        sectionTitle: page.section?.title ?? null,
        snippet,
        updatedAt: page.updatedAt.toISOString(),
      };
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error("GET /api/docs/[projectKey]/search error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
