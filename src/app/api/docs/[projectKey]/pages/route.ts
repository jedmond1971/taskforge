import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DocPageType } from "@prisma/client";
import { resolveDocCtx, isDocsWriteLocked } from "@/app/api/docs/_helpers";
import { canEditIssues, getUserGrants } from "@/lib/permissions";
import { sanitizeTipTapHtml } from "@/lib/sanitize-html";
import { logError } from "@/lib/security-events";

// GET /api/docs/[projectKey]/pages
export async function GET(req: NextRequest, props: { params: Promise<{ projectKey: string }> }) {
  const params = await props.params;
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
    logError("GET /api/docs/[projectKey]/pages error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/docs/[projectKey]/pages — requires TEAM_MEMBER or PROJECT_LEAD
export async function POST(req: NextRequest, props: { params: Promise<{ projectKey: string }> }) {
  const params = await props.params;
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ctx = await resolveDocCtx(params.projectKey, session.user.id);
    if (!ctx) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    if (!ctx.role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (isDocsWriteLocked(ctx.isClosed, session.user.role === "ADMIN")) {
      return NextResponse.json({ error: "This project is closed" }, { status: 403 });
    }
    const grants = await getUserGrants(session.user.id, ctx.orgId, ctx.projectId);
    if (!canEditIssues(ctx.role, grants)) {
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
        // Same rule as every other write path: TipTap HTML is stored sanitized, because the
        // viewer renders it without sanitizing (and public docspaces are readable cross-org).
        content: content != null ? sanitizeTipTapHtml(content) : null,
        authorId: session.user.id,
        position: position ?? nextPosition,
      },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    return NextResponse.json({ page }, { status: 201 });
  } catch (error) {
    logError("POST /api/docs/[projectKey]/pages error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
