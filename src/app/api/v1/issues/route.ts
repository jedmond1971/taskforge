import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateIssueKeyWithRetry } from "@/lib/issue-keys";
import { IssuePriority, IssueType, Prisma } from "@prisma/client";
import { resolveStatusForProject, PRIORITY_MAP, formatIssue } from "../_helpers";
import { requireV1ApiKey } from "@/lib/v1-auth";
import { sanitizeTipTapHtml } from "@/lib/sanitize-html";

const ISSUE_INCLUDE = {
  projectStatus: { select: { id: true, name: true, category: true } },
  assignee: { select: { id: true, name: true } },
  reporter: { select: { id: true, name: true } },
  project: { select: { id: true, key: true, name: true } },
  _count: { select: { comments: true, attachments: true } },
} as const;

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
      if (!projectId) {
        return NextResponse.json(
          { error: "projectId is required when filtering by status" },
          { status: 400 }
        );
      }
      const resolved = await resolveStatusForProject(projectId, statusParam);
      if (!resolved) {
        return NextResponse.json({ error: `Status not found: ${statusParam}` }, { status: 400 });
      }
      where.statusId = resolved.id;
    }
    if (assigneeId) where.assigneeId = assigneeId;

    const [issues, total] = await Promise.all([
      prisma.issue.findMany({
        where,
        include: ISSUE_INCLUDE,
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
    const { projectId, title, description, status, priority, assigneeId, reporterId } = body;

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

    // Resolve status: accept name string, fall back to TODO default
    let resolvedStatusId: string;
    if (status && typeof status === "string") {
      const resolved = await resolveStatusForProject(projectId, status);
      if (!resolved) {
        return NextResponse.json({ error: `Status not found: ${status}` }, { status: 400 });
      }
      resolvedStatusId = resolved.id;
    } else {
      const defaultStatus = await prisma.projectStatus.findFirst({
        where: { projectId, category: "TODO", isDefault: true },
        select: { id: true },
      });
      if (!defaultStatus) {
        return NextResponse.json({ error: "Project has no default status" }, { status: 400 });
      }
      resolvedStatusId = defaultStatus.id;
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
            statusId: resolvedStatusId,
            priority: resolvedPriority,
            type: IssueType.TASK,
            assigneeId: typeof assigneeId === "string" ? assigneeId : null,
            reporterId: resolvedReporterId,
            labels: [],
            position: issueCount,
          },
          include: ISSUE_INCLUDE,
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return NextResponse.json(formatIssue(issue as any), { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
