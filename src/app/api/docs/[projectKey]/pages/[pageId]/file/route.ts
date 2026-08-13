import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { putObject, getPresignedDownloadUrl, deleteObject, deleteObjectsWithPrefix, getObjectBuffer } from "@/lib/s3";
import { resolveDocCtx } from "@/app/api/docs/_helpers";
import { canEditIssues, getUserGrants } from "@/lib/permissions";
import { convertDocxToPreviewHtml } from "@/lib/docx-preview";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const maxDuration = 60;

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);
const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".doc"]);

function isAllowed(mimeType: string, fileName: string): boolean {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) return false;
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function resolvePage(projectKey: string, pageId: string, userId: string) {
  const ctx = await resolveDocCtx(projectKey, userId);
  if (!ctx) return null;

  const page = await prisma.docPage.findFirst({
    where: { id: pageId, docSpaceId: ctx.docSpaceId },
  });
  if (!page) return null;

  return { page, role: ctx.role, projectId: ctx.projectId, orgId: ctx.orgId };
}

// GET /api/docs/[projectKey]/pages/[pageId]/file — return a presigned download URL
export async function GET(
  _req: NextRequest,
  { params }: { params: { projectKey: string; pageId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await resolvePage(params.projectKey, params.pageId, session.user.id);
    if (!result) return NextResponse.json({ error: "Page not found" }, { status: 404 });
    if (!result.page.fileKey) return NextResponse.json({ error: "No file attached" }, { status: 404 });

    let html = result.page.docxPreviewHtml;
    if (html === null && result.page.mimeType === DOCX_MIME && result.page.fileKey) {
      const buffer = await getObjectBuffer(result.page.fileKey);
      html = await convertDocxToPreviewHtml(buffer, result.page.docSpaceId, result.page.id, params.projectKey);
      if (html !== null) {
        await prisma.docPage.update({ where: { id: result.page.id }, data: { docxPreviewHtml: html } });
      }
    }

    const url = await getPresignedDownloadUrl(result.page.fileKey);
    return NextResponse.json({ url, mimeType: result.page.mimeType, fileName: result.page.title, html });
  } catch (error) {
    console.error("GET /api/docs/.../file error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/docs/[projectKey]/pages/[pageId]/file — upload or replace the file (TEAM_MEMBER+)
export async function POST(
  req: NextRequest,
  { params }: { params: { projectKey: string; pageId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await resolvePage(params.projectKey, params.pageId, session.user.id);
    if (!result) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    if (!result.role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const grants = await getUserGrants(session.user.id, result.orgId, result.projectId);
    if (!canEditIssues(result.role, grants)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });

    if (!isAllowed(file.type, file.name)) {
      return NextResponse.json({ error: "Only PDF and DOCX files are allowed" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 400 });
    }

    const isReplace = !!result.page.fileKey;
    if (isReplace) {
      await Promise.all([
        deleteObject(result.page.fileKey!).catch(() => {}),
        deleteObjectsWithPrefix(`docs/${result.page.docSpaceId}/${result.page.id}/docx-images/`).catch(() => {}),
      ]);
    }

    const fileKey = `docs/${result.page.docSpaceId}/${result.page.id}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(fileKey, buffer, file.type);

    let docxPreviewHtml: string | null = null;
    if (file.type === DOCX_MIME) {
      docxPreviewHtml = await convertDocxToPreviewHtml(buffer, result.page.docSpaceId, result.page.id, params.projectKey);
    }

    const updated = await prisma.docPage.update({
      where: { id: result.page.id },
      data: {
        type: "DOCUMENT",
        fileKey,
        fileSize: file.size,
        mimeType: file.type,
        docxPreviewHtml,
      },
      include: {
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    return NextResponse.json({ page: updated });
  } catch (error) {
    console.error("POST /api/docs/.../file error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
