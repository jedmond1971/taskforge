import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DocPageType } from "@prisma/client";

async function resolveDocSpace(projectKey: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase(), members: { some: { userId } } },
    select: { id: true },
  });
  if (!project) return null;

  return prisma.docSpace.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id },
    update: {},
    select: { id: true },
  });
}

// GET /api/docs/[projectKey]/pages
export async function GET(
  req: NextRequest,
  { params }: { params: { projectKey: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const docSpace = await resolveDocSpace(params.projectKey, session.user.id);
    if (!docSpace) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const sectionId = searchParams.get("sectionId");

    const pages = await prisma.docPage.findMany({
      where: {
        docSpaceId: docSpace.id,
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

// POST /api/docs/[projectKey]/pages
export async function POST(
  req: NextRequest,
  { params }: { params: { projectKey: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const docSpace = await resolveDocSpace(params.projectKey, session.user.id);
    if (!docSpace) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { title, type, sectionId, content, position } = await req.json();
    if (!title?.trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });

    const pageType = type && Object.values(DocPageType).includes(type) ? type : DocPageType.NATIVE;

    if (sectionId) {
      const section = await prisma.docSection.findFirst({
        where: { id: sectionId, docSpaceId: docSpace.id },
      });
      if (!section) return NextResponse.json({ error: "Section not found" }, { status: 400 });
    }

    const maxPosition = await prisma.docPage.aggregate({
      where: { docSpaceId: docSpace.id, sectionId: sectionId ?? null },
      _max: { position: true },
    });
    const nextPosition = (maxPosition._max.position ?? -1) + 1;

    const page = await prisma.docPage.create({
      data: {
        docSpaceId: docSpace.id,
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
