import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/s3";
import { resolveDocCtx } from "@/app/api/docs/_helpers";
import { canEditIssues, canManageProject } from "@/lib/permissions";
import { sanitizeTipTapHtml } from "@/lib/sanitize-html";

async function resolvePage(projectKey: string, pageId: string, userId: string) {
  const ctx = await resolveDocCtx(projectKey, userId);
  if (!ctx) return null;

  const page = await prisma.docPage.findFirst({
    where: { id: pageId, docSpaceId: ctx.docSpaceId },
    include: {
      author: { select: { id: true, name: true, avatarUrl: true } },
      section: { select: { id: true, title: true } },
    },
  });
  if (!page) return null;

  return { page, role: ctx.role, isPublic: ctx.isPublic };
}

// GET /api/docs/[projectKey]/pages/[pageId]
export async function GET(
  _req: NextRequest,
  { params }: { params: { projectKey: string; pageId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await resolvePage(params.projectKey, params.pageId, session.user.id);
    if (!result) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    return NextResponse.json({ page: result.page });
  } catch (error) {
    console.error("GET /api/docs/[projectKey]/pages/[pageId] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/docs/[projectKey]/pages/[pageId] — requires TEAM_MEMBER or PROJECT_LEAD
export async function PATCH(
  req: NextRequest,
  { params }: { params: { projectKey: string; pageId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await resolvePage(params.projectKey, params.pageId, session.user.id);
    if (!result) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    if (!result.role || !canEditIssues(result.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { title, content, sectionId, position } = await req.json() as {
      title?: string;
      content?: string;
      sectionId?: string | null;
      position?: number;
    };
    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title.trim();
    if (content !== undefined) data.content = sanitizeTipTapHtml(content);
    if (sectionId !== undefined) data.sectionId = sectionId;
    if (position !== undefined) data.position = position;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    let updated;
    try {
      if (content !== undefined) {
        // Content update: snapshot previous revision, update page, prune old revisions — all atomic
        updated = await prisma.$transaction(async (tx) => {
          if (result.page.content) {
            await tx.pageRevision.create({
              data: {
                pageId: result.page.id,
                content: result.page.content,
                authorId: session.user.id,
              },
            });
          }

          const page = await tx.docPage.update({
            where: { id: result.page.id },
            data,
            include: {
              author: { select: { id: true, name: true, avatarUrl: true } },
              section: { select: { id: true, title: true } },
            },
          });

          // Prune: keep latest 50 revisions per page
          const revisionCount = await tx.pageRevision.count({ where: { pageId: result.page.id } });
          if (revisionCount > 50) {
            const oldest = await tx.pageRevision.findMany({
              where: { pageId: result.page.id },
              orderBy: { createdAt: "asc" },
              take: revisionCount - 50,
              select: { id: true },
            });
            await tx.pageRevision.deleteMany({
              where: { id: { in: oldest.map((r) => r.id) } },
            });
          }

          return page;
        });
      } else {
        updated = await prisma.docPage.update({
          where: { id: result.page.id },
          data,
          include: {
            author: { select: { id: true, name: true, avatarUrl: true } },
            section: { select: { id: true, title: true } },
          },
        });
      }
    } catch (error) {
      console.error("PATCH /api/docs/[projectKey]/pages/[pageId] write failed:", error);
      return NextResponse.json({ error: "Concurrent modification — please retry" }, { status: 409 });
    }

    return NextResponse.json({ page: updated });
  } catch (error) {
    console.error("PATCH /api/docs/[projectKey]/pages/[pageId] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/docs/[projectKey]/pages/[pageId] — requires PROJECT_LEAD
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { projectKey: string; pageId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await resolvePage(params.projectKey, params.pageId, session.user.id);
    if (!result) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    if (!result.role || !canManageProject(result.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (result.page.fileKey) {
      await deleteObject(result.page.fileKey).catch(() => {});
    }
    await prisma.docPage.delete({ where: { id: result.page.id } });

    return NextResponse.json({ deleted: true, id: result.page.id });
  } catch (error) {
    console.error("DELETE /api/docs/[projectKey]/pages/[pageId] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
