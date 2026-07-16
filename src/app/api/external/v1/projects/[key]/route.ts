import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireExternalApiKey, err, formatProject } from "../../_helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const ctx = await requireExternalApiKey(request);
    if (ctx instanceof NextResponse) return ctx;

    const project = await prisma.project.findFirst({
      where: { key: params.key.toUpperCase(), orgId: ctx.orgId, isClosed: false },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isPrivate: true,
        statuses: {
          select: { id: true, name: true, category: true, isDefault: true, position: true },
          orderBy: { position: "asc" },
        },
      },
    });

    if (!project) return err("Project not found", 404);

    return NextResponse.json(formatProject(project));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
