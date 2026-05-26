import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveDocCtx } from "@/app/api/docs/_helpers";

// GET /api/docs/[projectKey] — fetch (or lazily create) the docspace with sections and pages
export async function GET(
  _req: NextRequest,
  { params }: { params: { projectKey: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const ctx = await resolveDocCtx(params.projectKey, session.user.id);
    if (!ctx) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const docSpace = await prisma.docSpace.findUnique({
      where: { id: ctx.docSpaceId },
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

// PATCH /api/docs/[projectKey] — update docspace visibility (PROJECT_LEAD only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { projectKey: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const member = await prisma.projectMember.findFirst({
      where: {
        userId: session.user.id,
        project: { key: params.projectKey.toUpperCase() },
      },
      select: { role: true, project: { select: { id: true } } },
    });
    if (!member) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    if (member.role !== "PROJECT_LEAD") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json() as { isPublic?: unknown };
    if (typeof body.isPublic !== "boolean") {
      return NextResponse.json({ error: "isPublic must be a boolean" }, { status: 400 });
    }

    const docSpace = await prisma.docSpace.upsert({
      where: { projectId: member.project.id },
      create: { projectId: member.project.id, isPublic: body.isPublic },
      update: { isPublic: body.isPublic },
      select: { id: true, isPublic: true },
    });

    return NextResponse.json({ docSpace });
  } catch (error) {
    console.error("PATCH /api/docs/[projectKey] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
