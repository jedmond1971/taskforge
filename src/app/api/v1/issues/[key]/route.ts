import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { IssueStatus } from "@prisma/client";
import { STATUS_MAP, PRIORITY_MAP, formatIssue } from "../../_helpers";
import { requireV1ApiKey } from "@/lib/v1-auth";
import { sanitizeTipTapHtml } from "@/lib/sanitize-html";

export async function GET(
  request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const authError = requireV1ApiKey(request);
    if (authError) return authError;
    const issue = await prisma.issue.findUnique({
      where: { key: params.key.toUpperCase() },
      include: {
        assignee: { select: { id: true, name: true } },
        reporter: { select: { id: true, name: true } },
        project: { select: { id: true, key: true, name: true } },
        _count: { select: { comments: true, attachments: true } },
      },
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
      select: { id: true },
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
      updates.description = typeof body.description === "string" ? sanitizeTipTapHtml(body.description) : null;
    }

    if ("statusId" in body) {
      const statusId = body.statusId;
      if (statusId === null || statusId === undefined) {
        updates.status = IssueStatus.TODO;
      } else if (typeof statusId === "string") {
        const resolved = STATUS_MAP[statusId];
        if (!resolved) {
          return NextResponse.json({ error: `Invalid statusId: ${statusId}` }, { status: 400 });
        }
        updates.status = resolved;
      } else {
        return NextResponse.json({ error: "statusId must be a string" }, { status: 400 });
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
        const full = await prisma.issue.findUnique({
          where: { id: issue.id },
          select: { projectId: true },
        });
        if (full) {
          const assigneeMember = await prisma.projectMember.findUnique({
            where: { userId_projectId: { userId: assigneeId, projectId: full.projectId } },
          });
          if (!assigneeMember) {
            return NextResponse.json(
              { error: "Assignee is not a member of this project" },
              { status: 400 }
            );
          }
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
      include: {
        assignee: { select: { id: true, name: true } },
        reporter: { select: { id: true, name: true } },
        project: { select: { id: true, key: true, name: true } },
        _count: { select: { comments: true, attachments: true } },
      },
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
