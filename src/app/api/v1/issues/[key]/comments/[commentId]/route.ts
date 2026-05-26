import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { key: string; commentId: string } }
) {
  try {
    const comment = await prisma.comment.findUnique({
      where: { id: params.commentId },
      include: { issue: { select: { key: true } } },
    });
    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }
    if (comment.issue.key !== params.key.toUpperCase()) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    const body = (await request.json()) as Record<string, unknown>;

    if (typeof body.body !== "string" || !body.body.trim()) {
      return NextResponse.json({ error: "body must be a non-empty string" }, { status: 400 });
    }

    const updated = await prisma.comment.update({
      where: { id: params.commentId },
      data: { body: body.body.trim() },
      include: { author: { select: { id: true, name: true } } },
    });

    return NextResponse.json({
      id: updated.id,
      issueId: updated.issueId,
      body: updated.body,
      authorId: updated.authorId,
      author: updated.author,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { key: string; commentId: string } }
) {
  try {
    const comment = await prisma.comment.findUnique({
      where: { id: params.commentId },
      include: { issue: { select: { key: true } } },
    });
    if (!comment) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }
    if (comment.issue.key !== params.key.toUpperCase()) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }

    await prisma.comment.delete({ where: { id: params.commentId } });

    return NextResponse.json({ deleted: true, id: params.commentId });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
