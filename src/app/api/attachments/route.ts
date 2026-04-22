import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPresignedDownloadUrl } from "@/lib/s3";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const issueId = request.nextUrl.searchParams.get("issueId");
    if (!issueId) {
      return NextResponse.json({ error: "issueId required" }, { status: 400 });
    }

    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { projectId: true },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    const member = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: { userId: session.user.id, projectId: issue.projectId },
      },
    });
    if (!member) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const attachments = await prisma.attachment.findMany({
      where: { issueId },
      include: { uploader: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });

    const withUrls = await Promise.all(
      attachments.map(async (a) => ({
        ...a,
        downloadUrl: await getPresignedDownloadUrl(a.fileKey),
      }))
    );

    return NextResponse.json({ attachments: withUrls });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
