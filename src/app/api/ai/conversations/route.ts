import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireProjectRole, canViewProject } from "@/lib/permissions";
import { isAiChatEnabled } from "@/lib/ai/feature-flag";

export async function GET(request: NextRequest) {
  if (!isAiChatEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const issueId = request.nextUrl.searchParams.get("issueId");
  if (!issueId) {
    return NextResponse.json({ error: "issueId is required" }, { status: 400 });
  }

  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { project: { select: { key: true } } },
  });
  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  try {
    await requireProjectRole(issue.project.key, canViewProject);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const conversation = await prisma.aiConversation.findUnique({
    where: { userId_issueId: { userId: session.user.id, issueId } },
    select: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, toolCalls: true, createdAt: true },
      },
    },
  });

  return NextResponse.json({ messages: conversation?.messages ?? [] });
}
