import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SYNTH_STATUSES } from "../_helpers";
import { requireV1ApiKey } from "@/lib/v1-auth";

export async function GET(request: NextRequest) {
  try {
    const authError = requireV1ApiKey(request);
    if (authError) return authError;
    const projects = await prisma.project.findMany({
      where: { isArchived: false },
      select: { id: true, name: true, key: true },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({
      projects: projects.map((p) => ({ ...p, statuses: SYNTH_STATUSES })),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
