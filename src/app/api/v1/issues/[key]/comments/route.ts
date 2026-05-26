import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function formatComment(comment: {
  id: string;
  issueId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  author?: { id: string; name: string } | null;
}) {
  return {
    id: comment.id,
    issueId: comment.issueId,
    body: comment.body,
    authorId: comment.authorId,
    author: comment.author ?? null,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { key: string } }
) {
  try {
    const issue = await prisma.issue.findUnique({
      where: { key: params.key.toUpperCase() },
      select: { id: true },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

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
  { params }: { params: { key: string } }
) {
  try {
    const issue = await prisma.issue.findUnique({
      where: { key: params.key.toUpperCase() },
      select: { id: true },
    });
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    const body = (await request.json()) as Record<string, unknown>;

    if (typeof body.body !== "string" || !body.body.trim()) {
      return NextResponse.json({ error: "body must be a non-empty string" }, { status: 400 });
    }
    if (typeof body.authorId !== "string" || !body.authorId.trim()) {
      return NextResponse.json({ error: "authorId must be a non-empty string" }, { status: 400 });
    }

    const author = await prisma.user.findUnique({
      where: { id: body.authorId },
      select: { id: true },
    });
    if (!author) {
      return NextResponse.json({ error: "Author not found" }, { status: 400 });
    }

    const comment = await prisma.comment.create({
      data: {
        issueId: issue.id,
        authorId: body.authorId,
        body: body.body.trim(),
      },
      include: { author: { select: { id: true, name: true } } },
    });

    return NextResponse.json(formatComment(comment), { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
