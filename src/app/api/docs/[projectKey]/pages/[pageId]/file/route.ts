import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { putObject, getPresignedDownloadUrl, deleteObject } from "@/lib/s3";

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
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase(), members: { some: { userId } } },
    select: { id: true },
  });
  if (!project) return null;

  const docSpace = await prisma.docSpace.findUnique({
    where: { projectId: project.id },
    select: { id: true },
  });
  if (!docSpace) return null;

  return prisma.docPage.findFirst({
    where: { id: pageId, docSpaceId: docSpace.id },
  });
}

// GET /api/docs/[projectKey]/pages/[pageId]/file — return a presigned download URL
export async function GET(
  _req: NextRequest,
  { params }: { params: { projectKey: string; pageId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const page = await resolvePage(params.projectKey, params.pageId, session.user.id);
    if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });
    if (!page.fileKey) return NextResponse.json({ error: "No file attached" }, { status: 404 });

    const url = await getPresignedDownloadUrl(page.fileKey);
    return NextResponse.json({ url, mimeType: page.mimeType, fileName: page.title });
  } catch (error) {
    console.error("GET /api/docs/.../file error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/docs/[projectKey]/pages/[pageId]/file — upload or replace the file
export async function POST(
  req: NextRequest,
  { params }: { params: { projectKey: string; pageId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const page = await resolvePage(params.projectKey, params.pageId, session.user.id);
    if (!page) return NextResponse.json({ error: "Page not found" }, { status: 404 });

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });

    if (!isAllowed(file.type, file.name)) {
      return NextResponse.json({ error: "Only PDF and DOCX files are allowed" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 400 });
    }

    // Delete old file from S3 if replacing
    if (page.fileKey) {
      await deleteObject(page.fileKey).catch(() => {});
    }

    const fileKey = `docs/${page.docSpaceId}/${page.id}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(fileKey, buffer, file.type);

    const updated = await prisma.docPage.update({
      where: { id: page.id },
      data: {
        type: "DOCUMENT",
        fileKey,
        fileSize: file.size,
        mimeType: file.type,
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
