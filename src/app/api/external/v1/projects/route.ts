import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireExternalApiKey, formatProject } from "../_helpers";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireExternalApiKey(request);
    if (ctx instanceof NextResponse) return ctx;

    const projects = await prisma.project.findMany({
      where: { orgId: ctx.orgId, isClosed: false },
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        isPrivate: true,
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ projects: projects.map(formatProject) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
