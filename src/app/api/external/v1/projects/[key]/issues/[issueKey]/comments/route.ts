import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  requireExternalApiKey,
  requireProjectInOrg,
  formatComment,
  normalizeBody,
  err,
} from "../../../../../_helpers";

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
      select: { id: true },
    });
    if (!issue) return err("Issue not found", 404);

    const comments = await prisma.comment.findMany({
      where: { issueId: issue.id },
      include: { author: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ comments: comments.map(formatComment) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
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
      select: { id: true },
    });
    if (!issue) return err("Issue not found", 404);

    const body = (await request.json()) as Record<string, unknown>;

    if (typeof body.body !== "string" || !body.body.trim()) {
      return err("body must be a non-empty string", 400);
    }

    const comment = await prisma.comment.create({
      data: {
        issueId: issue.id,
        authorId: ctx.createdById,
        body: normalizeBody(body.body),
      },
      include: { author: { select: { id: true, name: true } } },
    });

    return NextResponse.json(formatComment(comment), { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
