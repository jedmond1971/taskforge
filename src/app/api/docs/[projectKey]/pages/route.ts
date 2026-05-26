import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DocPageType } from "@prisma/client";
import { resolveDocCtx } from "@/app/api/docs/_helpers";
import { canEditIssues } from "@/lib/permissions";

// GET /api/docs/[projectKey]/pages
export async function GET(
  req: NextRequest,
  { params }: { params: { projectKey: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ctx = await resolveDocCtx(params.projectKey, session.user.id);
    if (!ctx) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const sectionId = searchParams.get("sectionId");

    const pages = await prisma.docPage.findMany({
      where: {
        docSpaceId: ctx.docSpaceId,
        ...(sectionId ? { sectionId } : {}),
      },
      orderBy: { position: "asc" },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    return NextResponse.json({ pages });
  } catch (error) {
    console.error("GET /api/docs/[projectKey]/pages error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/docs/[projectKey]/pages — requires TEAM_MEMBER or PROJECT_LEAD
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

    const { title, type, sectionId, content, position } = await req.json() as {
      title?: string;
      type?: string;
      sectionId?: string;
      content?: string;
      position?: number;
    };
    if (!title?.trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });

    const pageType = type && Object.values(DocPageType).includes(type as DocPageType) ? (type as DocPageType) : DocPageType.NATIVE;

    if (sectionId) {
      const section = await prisma.docSection.findFirst({
        where: { id: sectionId, docSpaceId: ctx.docSpaceId },
      });
      if (!section) return NextResponse.json({ error: "Section not found" }, { status: 400 });
    }

    const maxPosition = await prisma.docPage.aggregate({
      where: { docSpaceId: ctx.docSpaceId, sectionId: sectionId ?? null },
      _max: { position: true },
    });
    const nextPosition = (maxPosition._max.position ?? -1) + 1;

    const page = await prisma.docPage.create({
      data: {
        docSpaceId: ctx.docSpaceId,
        sectionId: sectionId ?? null,
        title: title.trim(),
        type: pageType,
        content: content ?? null,
        authorId: session.user.id,
        position: position ?? nextPosition,
      },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    return NextResponse.json({ page }, { status: 201 });
  } catch (error) {
    console.error("POST /api/docs/[projectKey]/pages error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
