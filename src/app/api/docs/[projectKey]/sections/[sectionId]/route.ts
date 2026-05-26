import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function resolveSection(projectKey: string, sectionId: string, userId: string) {
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

  const section = await prisma.docSection.findFirst({
    where: { id: sectionId, docSpaceId: docSpace.id },
  });
  return section;
}

// PATCH /api/docs/[projectKey]/sections/[sectionId]
export async function PATCH(
  req: NextRequest,
  { params }: { params: { projectKey: string; sectionId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const section = await resolveSection(params.projectKey, params.sectionId, session.user.id);
    if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });

    const { title, position } = await req.json();
    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title.trim();
    if (position !== undefined) data.position = position;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const updated = await prisma.docSection.update({
      where: { id: section.id },
      data,
    });

    return NextResponse.json({ section: updated });
  } catch (error) {
    console.error("PATCH /api/docs/[projectKey]/sections/[sectionId] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/docs/[projectKey]/sections/[sectionId]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { projectKey: string; sectionId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const section = await resolveSection(params.projectKey, params.sectionId, session.user.id);
    if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });

    await prisma.docSection.delete({ where: { id: section.id } });

    return NextResponse.json({ deleted: true, id: section.id });
  } catch (error) {
    console.error("DELETE /api/docs/[projectKey]/sections/[sectionId] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
