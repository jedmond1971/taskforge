import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, key, description } = await request.json();

    if (!name || !key) {
      return NextResponse.json({ error: "Name and key are required" }, { status: 400 });
    }

    const existing = await prisma.project.findUnique({ where: { key: key.toUpperCase() } });
    if (existing) {
      return NextResponse.json({ error: "Project key already in use" }, { status: 409 });
    }

    const project = await prisma.project.create({
      data: {
        name,
        key: key.toUpperCase(),
        description: description || null,
        members: {
          create: {
            userId: session.user.id,
            role: "OWNER",
          },
        },
      },
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    console.error("Create project error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
