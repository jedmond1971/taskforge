import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SYNTH_STATUSES } from "../_helpers";

export async function GET() {
  try {
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
