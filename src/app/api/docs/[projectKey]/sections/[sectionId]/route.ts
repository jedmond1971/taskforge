import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveDocCtx } from "@/app/api/docs/_helpers";
import { canEditIssues, canManageProject } from "@/lib/permissions";

async function resolveSection(projectKey: string, sectionId: string, userId: string) {
  const ctx = await resolveDocCtx(projectKey, userId);
  if (!ctx) return null;

  const section = await prisma.docSection.findFirst({
    where: { id: sectionId, docSpaceId: ctx.docSpaceId },
  });
  if (!section) return null;

  return { section, role: ctx.role };
}

// PATCH /api/docs/[projectKey]/sections/[sectionId] — requires TEAM_MEMBER or PROJECT_LEAD
export async function PATCH(
  req: NextRequest,
  { params }: { params: { projectKey: string; sectionId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await resolveSection(params.projectKey, params.sectionId, session.user.id);
    if (!result) return NextResponse.json({ error: "Section not found" }, { status: 404 });

    if (!result.role || !canEditIssues(result.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { title, position } = await req.json() as { title?: string; position?: number };
    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title.trim();
    if (position !== undefined) data.position = position;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const updated = await prisma.docSection.update({
      where: { id: result.section.id },
      data,
    });

    return NextResponse.json({ section: updated });
  } catch (error) {
    console.error("PATCH /api/docs/[projectKey]/sections/[sectionId] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/docs/[projectKey]/sections/[sectionId] — requires PROJECT_LEAD
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { projectKey: string; sectionId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await resolveSection(params.projectKey, params.sectionId, session.user.id);
    if (!result) return NextResponse.json({ error: "Section not found" }, { status: 404 });

    if (!result.role || !canManageProject(result.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.docSection.delete({ where: { id: result.section.id } });

    return NextResponse.json({ deleted: true, id: result.section.id });
  } catch (error) {
    console.error("DELETE /api/docs/[projectKey]/sections/[sectionId] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
