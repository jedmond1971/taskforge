import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SYNTH_STATUSES } from "../../_helpers";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: {
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
      statuses: SYNTH_STATUSES,
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
