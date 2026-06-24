import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireV1ApiKey } from "@/lib/v1-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authError = requireV1ApiKey(request);
    if (authError) return authError;
    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
        statuses: {
          select: { id: true, name: true, category: true, isDefault: true },
          orderBy: { position: "asc" },
        },
        members: {
          include: {
            user: { select: { id: true, name: true, email: true, avatarUrl: true } },
          },
        },
      },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: project.id,
      name: project.name,
      key: project.key,
      description: project.description,
      statuses: project.statuses,
      members: project.members.map((m) => ({
        id: m.id,
        role: m.role,
        user: m.user,
      })),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
