import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { IssuePriority, IssueType, Prisma } from "@prisma/client";
import { generateIssueKeyWithRetry } from "@/lib/issue-keys";
import { sanitizeTipTapHtml } from "@/lib/sanitize-html";
import {
  requireExternalApiKey,
  requireProjectInOrg,
  resolveStatusForProject,
  PRIORITY_MAP,
  TYPE_MAP,
  ISSUE_INCLUDE,
  formatIssue,
  err,
} from "../../../_helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const ctx = await requireExternalApiKey(request);
    if (ctx instanceof NextResponse) return ctx;

    const project = await requireProjectInOrg(params.key, ctx.orgId);
    if (!project) return err("Project not found", 404);

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const priorityParam = searchParams.get("priority");
    const assigneeId = searchParams.get("assigneeId");
    const typeParam = searchParams.get("type");
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
    const offset = Math.max(parseInt(searchParams.get("offset") ?? "0", 10), 0);

    const where: Prisma.IssueWhereInput = { projectId: project.id };

    if (statusParam) {
      const resolved = await resolveStatusForProject(project.id, statusParam);
      if (!resolved) return err(`Status not found: ${statusParam}`, 400);
      where.statusId = resolved.id;
    }

    if (priorityParam) {
      const p = PRIORITY_MAP[priorityParam.toUpperCase()];
      if (!p) return err(`Invalid priority: ${priorityParam}. Use LOW, MEDIUM, HIGH, or CRITICAL`, 400);
      where.priority = p;
    }

    if (assigneeId) {
      const member = await prisma.projectMember.findUnique({
        where: { userId_projectId: { userId: assigneeId, projectId: project.id } },
        select: { userId: true },
      });
      if (!member) return err("Assignee is not a member of this project", 400);
      where.assigneeId = assigneeId;
    }

    if (typeParam) {
      const t = TYPE_MAP[typeParam.toUpperCase()];
      if (!t) return err(`Invalid type: ${typeParam}. Use TASK, BUG, STORY, or EPIC`, 400);
      where.type = t;
    }

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

export async function POST(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const ctx = await requireExternalApiKey(request);
    if (ctx instanceof NextResponse) return ctx;

    const project = await requireProjectInOrg(params.key, ctx.orgId);
    if (!project) return err("Project not found", 404);

    const body = (await request.json()) as Record<string, unknown>;
    const { title, description, status, priority, type, assigneeId, dueDate, labels } = body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return err("title is required", 400);
    }

    // Resolve status
    let statusId: string;
    if (status && typeof status === "string") {
      const resolved = await resolveStatusForProject(project.id, status);
      if (!resolved) return err(`Status not found: ${status}`, 400);
      statusId = resolved.id;
    } else {
      const defaultStatus = await prisma.projectStatus.findFirst({
        where: { projectId: project.id, category: "TODO", isDefault: true },
        select: { id: true },
      });
      if (!defaultStatus) return err("Project has no default status", 400);
      statusId = defaultStatus.id;
    }

    // Resolve priority
    let resolvedPriority: IssuePriority = IssuePriority.MEDIUM;
    if (priority && typeof priority === "string") {
      const p = PRIORITY_MAP[priority.toUpperCase()];
      if (!p) return err(`Invalid priority: ${priority}. Use LOW, MEDIUM, HIGH, or CRITICAL`, 400);
      resolvedPriority = p;
    }

    // Resolve type
    let resolvedType: IssueType = IssueType.TASK;
    if (type && typeof type === "string") {
      const t = TYPE_MAP[type.toUpperCase()];
      if (!t) return err(`Invalid type: ${type}. Use TASK, BUG, STORY, or EPIC`, 400);
      resolvedType = t;
    }

    // Validate assignee belongs to project
    if (assigneeId !== null && assigneeId !== undefined) {
      if (typeof assigneeId !== "string") return err("assigneeId must be a string or null", 400);
      const member = await prisma.projectMember.findUnique({
        where: { userId_projectId: { userId: assigneeId, projectId: project.id } },
        select: { userId: true },
      });
      if (!member) return err("Assignee is not a member of this project", 400);
    }

    // Validate dueDate
    let resolvedDueDate: Date | undefined;
    if (dueDate !== undefined && dueDate !== null) {
      if (typeof dueDate !== "string") return err("dueDate must be an ISO 8601 string or null", 400);
      const d = new Date(dueDate);
      if (isNaN(d.getTime())) return err("dueDate is not a valid date", 400);
      resolvedDueDate = d;
    }

    // Validate labels
    const resolvedLabels: string[] = [];
    if (labels !== undefined && labels !== null) {
      if (!Array.isArray(labels) || !labels.every((l) => typeof l === "string")) {
        return err("labels must be an array of strings", 400);
      }
      resolvedLabels.push(...(labels as string[]));
    }

    const issueCount = await prisma.issue.count({ where: { projectId: project.id } });

    let issue: Awaited<ReturnType<typeof prisma.issue.create>> | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const issueKey = await generateIssueKeyWithRetry(project.key);
      try {
        issue = await prisma.issue.create({
          data: {
            key: issueKey,
            projectId: project.id,
            title: (title as string).trim(),
            description:
              typeof description === "string"
                ? sanitizeTipTapHtml(description)
                : null,
            statusId,
            priority: resolvedPriority,
            type: resolvedType,
            assigneeId: typeof assigneeId === "string" ? assigneeId : null,
            reporterId: ctx.createdById,
            labels: resolvedLabels,
            position: issueCount,
            dueDate: resolvedDueDate ?? null,
          },
          include: ISSUE_INCLUDE,
        });
        break;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
    }
    if (!issue) return err("Could not generate unique issue key", 500);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return NextResponse.json(formatIssue(issue as any), { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
