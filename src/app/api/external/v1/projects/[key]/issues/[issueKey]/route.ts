import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { IssuePriority, IssueType } from "@prisma/client";
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
} from "../../../../_helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: { key: string; issueKey: string } }
) {
  try {
    const ctx = await requireExternalApiKey(request);
    if (ctx instanceof NextResponse) return ctx;

    const project = await requireProjectInOrg(params.key, ctx.orgId);
    if (!project) return err("Project not found", 404);

    const issue = await prisma.issue.findFirst({
      where: { key: params.issueKey.toUpperCase(), projectId: project.id },
      include: ISSUE_INCLUDE,
    });
    if (!issue) return err("Issue not found", 404);

    return NextResponse.json(formatIssue(issue));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { key: string; issueKey: string } }
) {
  try {
    const ctx = await requireExternalApiKey(request);
    if (ctx instanceof NextResponse) return ctx;

    const project = await requireProjectInOrg(params.key, ctx.orgId);
    if (!project) return err("Project not found", 404);

    const issue = await prisma.issue.findFirst({
      where: { key: params.issueKey.toUpperCase(), projectId: project.id },
      select: { id: true, projectId: true, statusId: true },
    });
    if (!issue) return err("Issue not found", 404);

    const body = (await request.json()) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if ("title" in body) {
      if (typeof body.title !== "string" || !body.title.trim()) {
        return err("title must be a non-empty string", 400);
      }
      updates.title = body.title.trim();
    }

    if ("description" in body) {
      updates.description =
        typeof body.description === "string"
          ? sanitizeTipTapHtml(body.description)
          : null;
    }

    if ("status" in body) {
      const statusValue = body.status;
      if (statusValue === null || statusValue === undefined) {
        const defaultStatus = await prisma.projectStatus.findFirst({
          where: { projectId: project.id, category: "TODO", isDefault: true },
          select: { id: true },
        });
        if (defaultStatus) updates.statusId = defaultStatus.id;
      } else if (typeof statusValue === "string") {
        const resolved = await resolveStatusForProject(project.id, statusValue);
        if (!resolved) return err(`Status not found: ${statusValue}`, 400);
        updates.statusId = resolved.id;
        if (resolved.id !== issue.statusId) {
          const colCount = await prisma.issue.count({
            where: { projectId: project.id, statusId: resolved.id },
          });
          updates.position = colCount;
        }
      } else {
        return err("status must be a string or null", 400);
      }
    }

    if ("priority" in body) {
      if (typeof body.priority !== "string") return err("priority must be a string", 400);
      const p = PRIORITY_MAP[body.priority.toUpperCase()];
      if (!p) return err(`Invalid priority: ${body.priority}. Use LOW, MEDIUM, HIGH, or CRITICAL`, 400);
      updates.priority = p as IssuePriority;
    }

    if ("type" in body) {
      if (typeof body.type !== "string") return err("type must be a string", 400);
      const t = TYPE_MAP[body.type.toUpperCase()];
      if (!t) return err(`Invalid type: ${body.type}. Use TASK, BUG, STORY, or EPIC`, 400);
      updates.type = t as IssueType;
    }

    if ("assigneeId" in body) {
      const assigneeId = body.assigneeId;
      if (assigneeId === null || assigneeId === undefined) {
        updates.assigneeId = null;
      } else {
        if (typeof assigneeId !== "string") return err("assigneeId must be a string or null", 400);
        // Scope check: must be a member of this (org-scoped) project
        const member = await prisma.projectMember.findUnique({
          where: { userId_projectId: { userId: assigneeId, projectId: project.id } },
          select: { userId: true },
        });
        if (!member) return err("Assignee is not a member of this project", 400);
        updates.assigneeId = assigneeId;
      }
    }

    if ("dueDate" in body) {
      const dueDate = body.dueDate;
      if (dueDate === null || dueDate === undefined) {
        updates.dueDate = null;
      } else {
        if (typeof dueDate !== "string") return err("dueDate must be an ISO 8601 string or null", 400);
        const d = new Date(dueDate);
        if (isNaN(d.getTime())) return err("dueDate is not a valid date", 400);
        updates.dueDate = d;
      }
    }

    if ("labels" in body) {
      const labels = body.labels;
      if (labels === null || labels === undefined) {
        updates.labels = [];
      } else {
        if (!Array.isArray(labels) || !labels.every((l) => typeof l === "string")) {
          return err("labels must be an array of strings", 400);
        }
        updates.labels = labels;
      }
    }

    if (Object.keys(updates).length === 0) return err("No valid fields to update", 400);

    const updated = await prisma.issue.update({
      where: { id: issue.id },
      data: updates,
      include: ISSUE_INCLUDE,
    });

    return NextResponse.json(formatIssue(updated));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
