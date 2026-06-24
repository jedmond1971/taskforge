import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function resolvePageInProject(projectKey: string, pageId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase(), members: { some: { userId } } },
    select: { id: true },
  });
  if (!project) return null;

  const docSpace = await prisma.docSpace.findUnique({
    where: { projectId: project.id },
    select: { id: true },
  });
  if (!docSpace) return null;

  const page = await prisma.docPage.findFirst({
    where: { id: pageId, docSpaceId: docSpace.id },
    select: { id: true },
  });
  if (!page) return null;

  return { projectId: project.id, pageId: page.id };
}

// GET /api/docs/[projectKey]/pages/[pageId]/links
// Returns issues linked to this page
export async function GET(
  _req: NextRequest,
  { params }: { params: { projectKey: string; pageId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const resolved = await resolvePageInProject(params.projectKey, params.pageId, session.user.id);
    if (!resolved) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    const links = await prisma.issueDocLink.findMany({
      where: { pageId: resolved.pageId },
      include: {
        issue: {
          select: {
            id: true,
            key: true,
            title: true,
            projectStatus: { select: { id: true, name: true, category: true } },
            priority: true,
            type: true,
            assignee: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ links });
  } catch (error) {
    console.error("GET /api/docs/[projectKey]/pages/[pageId]/links error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
