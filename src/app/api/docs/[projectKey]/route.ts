import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getProjectForMember(projectKey: string, userId: string) {
  return prisma.project.findFirst({
    where: {
      key: projectKey.toUpperCase(),
      members: { some: { userId } },
    },
    select: { id: true, key: true },
  });
}

// GET /api/docs/[projectKey] — fetch (or lazily create) the docspace with sections and pages
export async function GET(
  _req: NextRequest,
  { params }: { params: { projectKey: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const project = await getProjectForMember(params.projectKey, session.user.id);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const docSpace = await prisma.docSpace.upsert({
      where: { projectId: project.id },
      create: { projectId: project.id },
      update: {},
      include: {
        sections: {
          orderBy: { position: "asc" },
          include: {
            pages: {
              orderBy: { position: "asc" },
              select: { id: true, title: true, type: true, position: true, createdAt: true, updatedAt: true },
            },
          },
        },
        pages: {
          where: { sectionId: null },
          orderBy: { position: "asc" },
          select: { id: true, title: true, type: true, position: true, createdAt: true, updatedAt: true },
        },
      },
    });

    return NextResponse.json({ docSpace });
  } catch (error) {
    console.error("GET /api/docs/[projectKey] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
