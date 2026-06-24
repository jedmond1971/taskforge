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

    const { orgId } = session.user;
    if (!orgId) {
      return NextResponse.json({ error: "No active organization on session" }, { status: 400 });
    }

    const existing = await prisma.project.findUnique({ where: { key: key.toUpperCase() } });
    if (existing) {
      return NextResponse.json({ error: "Project key already in use" }, { status: 409 });
    }

    // Verify the session orgId is still a live OrgMember row — the JWT is
    // cached and could reference an org the user was removed from.
    const orgMembership = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: session.user.id } },
    });
    if (!orgMembership) {
      return NextResponse.json(
        { error: "Your session organization is no longer valid. Please sign in again." },
        { status: 403 }
      );
    }

    const project = await prisma.project.create({
      data: {
        name,
        key: key.toUpperCase(),
        description: description || null,
        orgId,
        members: {
          create: {
            userId: session.user.id,
            role: "PROJECT_LEAD",
          },
        },
        statuses: {
          createMany: {
            data: [
              { name: "To Do",       category: "TODO",        position: 0, isDefault: true },
              { name: "In Progress", category: "IN_PROGRESS", position: 0, isDefault: true },
              { name: "Done",        category: "DONE",        position: 0, isDefault: true },
            ],
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
