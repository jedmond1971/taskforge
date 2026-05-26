import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

// GET /api/docs/[projectKey]/sections
export async function GET(
  _req: NextRequest,
  { params }: { params: { projectKey: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const docSpace = await resolveDocSpace(params.projectKey, session.user.id);
    if (!docSpace) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const sections = await prisma.docSection.findMany({
      where: { docSpaceId: docSpace.id },
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

// POST /api/docs/[projectKey]/sections
export async function POST(
  req: NextRequest,
  { params }: { params: { projectKey: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const docSpace = await resolveDocSpace(params.projectKey, session.user.id);
    if (!docSpace) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const { title, position } = await req.json();
    if (!title?.trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });

    const maxPosition = await prisma.docSection.aggregate({
      where: { docSpaceId: docSpace.id },
      _max: { position: true },
    });
    const nextPosition = (maxPosition._max.position ?? -1) + 1;

    const section = await prisma.docSection.create({
      data: {
        docSpaceId: docSpace.id,
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
