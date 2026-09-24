import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireV1ApiKey } from "@/lib/v1-auth";
import { logError } from "@/lib/security-events";

export async function GET(request: NextRequest) {
  try {
    const authError = await requireV1ApiKey(request);
    if (authError) return authError;
    const projects = await prisma.project.findMany({
      where: { isClosed: false },
      select: {
        id: true,
        name: true,
        key: true,
        statuses: { select: { id: true, name: true, category: true, isDefault: true }, orderBy: { position: "asc" } },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ projects });
  } catch (error) {
    logError("GET /api/v1/projects", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
