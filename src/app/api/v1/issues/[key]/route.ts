import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveStatusForProject, PRIORITY_MAP, formatIssue } from "../../_helpers";
import { requireV1ApiKey } from "@/lib/v1-auth";
import { sanitizeTipTapHtml } from "@/lib/sanitize-html";

const ISSUE_INCLUDE = {
  projectStatus: { select: { id: true, name: true, category: true } },
  assignee: { select: { id: true, name: true } },
  reporter: { select: { id: true, name: true } },
  project: { select: { id: true, key: true, name: true } },
  _count: { select: { comments: true, attachments: true } },
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const authError = requireV1ApiKey(request);
    if (authError) return authError;
    const issue = await prisma.issue.findUnique({
      where: { key: params.key.toUpperCase() },
      include: ISSUE_INCLUDE,
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }
    return NextResponse.json(formatIssue(issue));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const authError = requireV1ApiKey(request);
    if (authError) return authError;
    const issue = await prisma.issue.findUnique({
      where: { key: params.key.toUpperCase() },
      select: { id: true, projectId: true, statusId: true },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if ("title" in body) {
      if (typeof body.title !== "string" || !body.title.trim()) {
        return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
      }
      updates.title = body.title.trim();
    }

    if ("description" in body) {
      updates.description = typeof body.description === "string"
        ? sanitizeTipTapHtml(body.description)
        : null;
    }

    // Accept "status" (name string) or "statusId" (name string or actual cuid, for backwards compat)
    const statusValue = "status" in body ? body.status : "statusId" in body ? body.statusId : undefined;
    if (statusValue !== undefined) {
      if (statusValue === null || statusValue === undefined) {
        // Null → reset to TODO default
        const defaultStatus = await prisma.projectStatus.findFirst({
          where: { projectId: issue.projectId, category: "TODO", isDefault: true },
          select: { id: true },
        });
        if (defaultStatus) updates.statusId = defaultStatus.id;
      } else if (typeof statusValue === "string") {
        // Try direct ID lookup first (for callers that pass the actual cuid)
        const byId = await prisma.projectStatus.findFirst({
          where: { id: statusValue, projectId: issue.projectId },
          select: { id: true },
        });
        if (byId) {
          updates.statusId = byId.id;
        } else {
          const resolved = await resolveStatusForProject(issue.projectId, statusValue);
          if (!resolved) {
            return NextResponse.json(
              { error: `Status not found: ${statusValue}` },
              { status: 400 }
            );
          }
          updates.statusId = resolved.id;
        }
        // Changing columns requires a new position to avoid the unique constraint
        if (updates.statusId !== issue.statusId) {
          const colCount = await prisma.issue.count({
            where: { projectId: issue.projectId, statusId: updates.statusId as string },
          });
          updates.position = colCount;
        }
      } else {
        return NextResponse.json({ error: "status must be a string or null" }, { status: 400 });
      }
    }

    if ("priority" in body) {
      if (typeof body.priority !== "string") {
        return NextResponse.json({ error: "priority must be a string" }, { status: 400 });
      }
      const p = PRIORITY_MAP[body.priority];
      if (!p) {
        return NextResponse.json(
          { error: `Invalid priority: ${body.priority}. Use LOW, MEDIUM, HIGH, CRITICAL, or URGENT` },
          { status: 400 }
        );
      }
      updates.priority = p;
    }

    if ("assigneeId" in body) {
      const assigneeId = body.assigneeId;
      if (assigneeId !== null && assigneeId !== undefined) {
        if (typeof assigneeId !== "string") {
          return NextResponse.json({ error: "assigneeId must be a string or null" }, { status: 400 });
        }
        const assigneeMember = await prisma.projectMember.findUnique({
          where: { userId_projectId: { userId: assigneeId, projectId: issue.projectId } },
        });
        if (!assigneeMember) {
          return NextResponse.json(
            { error: "Assignee is not a member of this project" },
            { status: 400 }
          );
        }
        updates.assigneeId = assigneeId;
      } else {
        updates.assigneeId = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

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

export async function DELETE(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const authError = requireV1ApiKey(request);
    if (authError) return authError;
    const issue = await prisma.issue.findUnique({
      where: { key: params.key.toUpperCase() },
      select: { id: true, key: true },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    await prisma.issue.delete({ where: { id: issue.id } });

    return NextResponse.json({ deleted: true, key: issue.key });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
