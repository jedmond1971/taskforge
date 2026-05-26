import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveDocCtx } from "@/app/api/docs/_helpers";
import { canEditIssues } from "@/lib/permissions";

// GET /api/docs/[projectKey]/sections
export async function GET(
  _req: NextRequest,
  { params }: { params: { projectKey: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ctx = await resolveDocCtx(params.projectKey, session.user.id);
    if (!ctx) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const sections = await prisma.docSection.findMany({
      where: { docSpaceId: ctx.docSpaceId },
      orderBy: { position: "asc" },
      include: {
        pages: {
          orderBy: { position: "asc" },
          select: { id: true, title: true, type: true, position: true },
        },
      },
    });

    return NextResponse.json({ sections });
  } catch (error) {
    console.error("GET /api/docs/[projectKey]/sections error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/docs/[projectKey]/sections — requires TEAM_MEMBER or PROJECT_LEAD
export async function POST(
  req: NextRequest,
  { params }: { params: { projectKey: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ctx = await resolveDocCtx(params.projectKey, session.user.id);
    if (!ctx) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    if (!ctx.role || !canEditIssues(ctx.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { title, position } = await req.json() as { title?: string; position?: number };
    if (!title?.trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });

    const maxPosition = await prisma.docSection.aggregate({
      where: { docSpaceId: ctx.docSpaceId },
      _max: { position: true },
    });
    const nextPosition = (maxPosition._max.position ?? -1) + 1;

    const section = await prisma.docSection.create({
      data: {
        docSpaceId: ctx.docSpaceId,
        title: title.trim(),
        position: position ?? nextPosition,
      },
    });

    return NextResponse.json({ section }, { status: 201 });
  } catch (error) {
    console.error("POST /api/docs/[projectKey]/sections error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
