import { IssuePriority, StatusCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const PRIORITY_MAP: Record<string, IssuePriority> = {
  LOW: IssuePriority.LOW,
  MEDIUM: IssuePriority.MEDIUM,
  HIGH: IssuePriority.HIGH,
  CRITICAL: IssuePriority.CRITICAL,
  URGENT: IssuePriority.CRITICAL,
};

// Resolve a status string (name or legacy category key) to a ProjectStatus record.
// Tries name match first ("To Do", "Done"), then category default fallback ("TODO", "DONE").
export async function resolveStatusForProject(projectId: string, statusValue: string) {
  // Try exact name match
  const byName = await prisma.projectStatus.findUnique({
    where: { projectId_name: { projectId, name: statusValue } },
  });
  if (byName) return byName;

  // Try case-insensitive name match
  const byNameCI = await prisma.projectStatus.findFirst({
    where: { projectId, name: { equals: statusValue, mode: "insensitive" } },
  });
  if (byNameCI) return byNameCI;

  // Try legacy category key (e.g. "TODO" → default TODO status)
  const categoryMap: Record<string, StatusCategory> = {
    TODO: "TODO",
    IN_PROGRESS: "IN_PROGRESS",
    IN_REVIEW: "IN_PROGRESS",
    DONE: "DONE",
    CANCELLED: "DONE",
  };
  const category = categoryMap[statusValue.toUpperCase()];
  if (category) {
    const byCategory = await prisma.projectStatus.findFirst({
      where: { projectId, category, isDefault: true },
    });
    if (byCategory) return byCategory;
  }

  return null;
}

export function formatIssue(issue: {
  id: string;
  key: string;
  title: string;
  description: string | null;
  statusId: string;
  projectStatus: { id: string; name: string; category: StatusCategory };
  priority: IssuePriority;
  projectId: string;
  assigneeId: string | null;
  reporterId: string;
  createdAt: Date;
  updatedAt: Date;
  assignee?: { id: string; name: string } | null;
  reporter?: { id: string; name: string } | null;
  project?: { id: string; key: string; name: string } | null;
  _count?: { comments: number; attachments: number } | null;
}) {
  return {
    id: issue.id,
    key: issue.key,
    title: issue.title,
    description: issue.description,
    status: {
      id: issue.projectStatus.id,
      name: issue.projectStatus.name,
      category: issue.projectStatus.category,
    },
    priority: issue.priority,
    projectId: issue.projectId,
    projectName: issue.project?.name ?? null,
    assigneeId: issue.assigneeId,
    assignee: issue.assignee ?? null,
    reporterId: issue.reporterId,
    reporter: issue.reporter ?? null,
    commentsCount: issue._count?.comments ?? 0,
    attachmentsCount: issue._count?.attachments ?? 0,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}
