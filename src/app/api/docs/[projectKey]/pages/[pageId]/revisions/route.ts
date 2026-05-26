import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET /api/docs/[projectKey]/pages/[pageId]/revisions
export async function GET(
  _req: NextRequest,
  { params }: { params: { projectKey: string; pageId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const project = await prisma.project.findFirst({
      where: {
        key: params.projectKey.toUpperCase(),
        members: { some: { userId: session.user.id } },
      },
      select: { id: true },
    });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const docSpace = await prisma.docSpace.findUnique({
      where: { projectId: project.id },
      select: { id: true },
    });
    if (!docSpace) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    const page = await prisma.docPage.findFirst({
      where: { id: params.pageId, docSpaceId: docSpace.id },
      select: { id: true },
    });
    if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    const revisions = await prisma.pageRevision.findMany({
      where: { pageId: page.id },
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    return NextResponse.json({ revisions });
  } catch (error) {
    console.error("GET /api/docs/[projectKey]/pages/[pageId]/revisions error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
