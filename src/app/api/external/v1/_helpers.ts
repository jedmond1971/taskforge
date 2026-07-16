import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sanitizeTipTapHtml } from "@/lib/sanitize-html";
import { StatusCategory, IssueType } from "@prisma/client";

export { requireExternalApiKey } from "@/lib/external-api-auth";
export type { ExternalApiContext } from "@/lib/external-api-auth";

// Re-export helpers shared with v1 internal API
export { resolveStatusForProject, PRIORITY_MAP, formatIssue } from "@/app/api/v1/_helpers";

export const ISSUE_INCLUDE = {
  projectStatus: { select: { id: true, name: true, category: true } },
  assignee: { select: { id: true, name: true } },
  reporter: { select: { id: true, name: true } },
  project: { select: { id: true, key: true, name: true } },
  _count: { select: { comments: true, attachments: true } },
} as const;

export const TYPE_MAP: Record<string, IssueType> = {
  TASK: IssueType.TASK,
  BUG: IssueType.BUG,
  STORY: IssueType.STORY,
  EPIC: IssueType.EPIC,
};

// Resolve a project by key scoped to the authenticated org.
// Returns null (→ 404) if the key doesn't exist in this org or is closed.
export async function requireProjectInOrg(projectKey: string, orgId: string) {
  return prisma.project.findFirst({
    where: { key: projectKey.toUpperCase(), orgId, isClosed: false },
    select: { id: true, key: true, name: true, description: true, isPrivate: true },
  });
}

export function err(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// Accept plain text OR TipTap HTML. Plain text is escaped and wrapped in <p>.
export function normalizeBody(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<")) {
    return sanitizeTipTapHtml(trimmed);
  }
  const escaped = trimmed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${escaped}</p>`;
}

export function formatComment(comment: {
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

export function formatProject(project: {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isPrivate: boolean;
  statuses?: Array<{ id: string; name: string; category: StatusCategory; isDefault: boolean; position: number }>;
}) {
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description,
    isPrivate: project.isPrivate,
    ...(project.statuses ? { statuses: project.statuses } : {}),
  };
}
