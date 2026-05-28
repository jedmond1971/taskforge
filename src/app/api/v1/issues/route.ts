import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateIssueKeyWithRetry } from "@/lib/issue-keys";
import { IssueStatus, IssuePriority, IssueType, Prisma } from "@prisma/client";
import { STATUS_MAP, PRIORITY_MAP, formatIssue, statusToObject } from "../_helpers";
import { requireV1ApiKey } from "@/lib/v1-auth";
import { sanitizeTipTapHtml } from "@/lib/sanitize-html";

export async function GET(request: NextRequest) {
  try {
    const authError = requireV1ApiKey(request);
    if (authError) return authError;
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const statusParam = searchParams.get("status");
    const assigneeId = searchParams.get("assigneeId");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10), 0);

    const where: Prisma.IssueWhereInput = {};
    if (projectId) where.projectId = projectId;
    if (statusParam) {
      const status = STATUS_MAP[statusParam];
      if (!status) {
        return NextResponse.json({ error: `Invalid status: ${statusParam}` }, { status: 400 });
      }
      where.status = status;
    }
    if (assigneeId) where.assigneeId = assigneeId;

    const [issues, total] = await Promise.all([
      prisma.issue.findMany({
        where,
        include: {
          assignee: { select: { id: true, name: true } },
          reporter: { select: { id: true, name: true } },
          project: { select: { id: true, key: true, name: true } },
          _count: { select: { comments: true, attachments: true } },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.issue.count({ where }),
    ]);

    return NextResponse.json({ issues: issues.map(formatIssue), total, limit, offset });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authError = requireV1ApiKey(request);
    if (authError) return authError;
    const body = (await request.json()) as Record<string, unknown>;
    const { projectId, title, description, statusId, priority, assigneeId, reporterId } = body;

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, key: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let status: IssueStatus = IssueStatus.TODO;
    if (statusId && typeof statusId === "string") {
      const resolved = STATUS_MAP[statusId];
      if (!resolved) {
        return NextResponse.json({ error: `Invalid statusId: ${statusId}` }, { status: 400 });
      }
      status = resolved;
    }

    let resolvedPriority: IssuePriority = IssuePriority.MEDIUM;
    if (priority && typeof priority === "string") {
      const p = PRIORITY_MAP[priority];
      if (!p) {
        return NextResponse.json(
          { error: `Invalid priority: ${priority}. Use LOW, MEDIUM, HIGH, CRITICAL, or URGENT` },
          { status: 400 }
        );
      }
      resolvedPriority = p;
    }

    let resolvedReporterId = typeof reporterId === "string" ? reporterId : null;
    if (!resolvedReporterId) {
      const firstMember = await prisma.projectMember.findFirst({
        where: { projectId },
        orderBy: { role: "asc" },
        select: { userId: true },
      });
      if (!firstMember) {
        return NextResponse.json({ error: "Project has no members" }, { status: 400 });
      }
      resolvedReporterId = firstMember.userId;
    }

    if (assigneeId && typeof assigneeId === "string") {
      const assigneeMember = await prisma.projectMember.findUnique({
        where: { userId_projectId: { userId: assigneeId, projectId } },
      });
      if (!assigneeMember) {
        return NextResponse.json(
          { error: "Assignee is not a member of this project" },
          { status: 400 }
        );
      }
    }

    const issueCount = await prisma.issue.count({ where: { projectId } });

    let issue: Awaited<ReturnType<typeof prisma.issue.create>> | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const issueKey = await generateIssueKeyWithRetry(project.key);
      try {
        issue = await prisma.issue.create({
          data: {
            key: issueKey,
            projectId,
            title: (title as string).trim(),
            description: typeof description === "string" ? sanitizeTipTapHtml(description) : null,
            status,
            priority: resolvedPriority,
            type: IssueType.TASK,
            assigneeId: typeof assigneeId === "string" ? assigneeId : null,
            reporterId: resolvedReporterId,
            labels: [],
            position: issueCount,
          },
        });
        break;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
    }
    if (!issue) {
      return NextResponse.json({ error: "Could not generate unique issue key" }, { status: 500 });
    }

    return NextResponse.json(
      {
        key: issue.key,
        id: issue.id,
        title: issue.title,
        status: statusToObject(issue.status),
        priority: issue.priority,
        projectId: issue.projectId,
        createdAt: issue.createdAt,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
