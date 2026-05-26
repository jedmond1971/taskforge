import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/s3";

async function resolvePage(projectKey: string, pageId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase(), members: { some: { userId } } },
    select: { id: true },
  });
  if (!project) return null;

  const docSpace = await prisma.docSpace.findUnique({
    where: { projectId: project.id },
    select: { id: true },
  });
  if (!docSpace) return null;

  return prisma.docPage.findFirst({
    where: { id: pageId, docSpaceId: docSpace.id },
    include: {
      author: { select: { id: true, name: true, avatarUrl: true } },
      section: { select: { id: true, title: true } },
    },
  });
}

// GET /api/docs/[projectKey]/pages/[pageId]
export async function GET(
  _req: NextRequest,
  { params }: { params: { projectKey: string; pageId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const page = await resolvePage(params.projectKey, params.pageId, session.user.id);
    if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    return NextResponse.json({ page });
  } catch (error) {
    console.error("GET /api/docs/[projectKey]/pages/[pageId] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/docs/[projectKey]/pages/[pageId]
export async function PATCH(
  req: NextRequest,
  { params }: { params: { projectKey: string; pageId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const page = await resolvePage(params.projectKey, params.pageId, session.user.id);
    if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    const { title, content, sectionId, position } = await req.json();
    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title.trim();
    if (content !== undefined) data.content = content;
    if (sectionId !== undefined) data.sectionId = sectionId;
    if (position !== undefined) data.position = position;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    // Snapshot current content as a revision before overwriting
    if (content !== undefined && page.content) {
      await prisma.pageRevision.create({
        data: {
          pageId: page.id,
          content: page.content,
          authorId: session.user.id,
        },
      });
    }

    const updated = await prisma.docPage.update({
      where: { id: page.id },
      data,
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
        section: { select: { id: true, title: true } },
      },
    });

    return NextResponse.json({ page: updated });
  } catch (error) {
    console.error("PATCH /api/docs/[projectKey]/pages/[pageId] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/docs/[projectKey]/pages/[pageId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { projectKey: string; pageId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const page = await resolvePage(params.projectKey, params.pageId, session.user.id);
    if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    if (page.fileKey) {
      await deleteObject(page.fileKey).catch(() => {});
    }
    await prisma.docPage.delete({ where: { id: page.id } });

    return NextResponse.json({ deleted: true, id: page.id });
  } catch (error) {
    console.error("DELETE /api/docs/[projectKey]/pages/[pageId] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
