import { IssueStatus, IssuePriority } from "@prisma/client";

export const STATUS_MAP: Record<string, IssueStatus> = {
  TODO: IssueStatus.TODO,
  IN_PROGRESS: IssueStatus.IN_PROGRESS,
  IN_REVIEW: IssueStatus.IN_REVIEW,
  DONE: IssueStatus.DONE,
  "To Do": IssueStatus.TODO,
  "In Progress": IssueStatus.IN_PROGRESS,
  "In Review": IssueStatus.IN_REVIEW,
  Done: IssueStatus.DONE,
};

export const PRIORITY_MAP: Record<string, IssuePriority> = {
  LOW: IssuePriority.LOW,
  MEDIUM: IssuePriority.MEDIUM,
  HIGH: IssuePriority.HIGH,
  CRITICAL: IssuePriority.CRITICAL,
  URGENT: IssuePriority.CRITICAL,
};

const STATUS_LABELS: Record<IssueStatus, string> = {
  TODO: "To Do",
  IN_PROGRESS: "In Progress",
  IN_REVIEW: "In Review",
  DONE: "Done",
};

export const SYNTH_STATUSES = (Object.entries(STATUS_LABELS) as [IssueStatus, string][]).map(
  ([id, name], order) => ({ id, name, order })
);

export function statusToObject(status: IssueStatus) {
  return { id: status as string, name: STATUS_LABELS[status] };
}

export function formatIssue(issue: {
  id: string;
  key: string;
  title: string;
  description: string | null;
  status: IssueStatus;
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
    status: statusToObject(issue.status),
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
