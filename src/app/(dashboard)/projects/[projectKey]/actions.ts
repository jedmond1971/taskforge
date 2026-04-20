"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { generateIssueKeyWithRetry } from "@/lib/issue-keys";
import {
  requireProjectRole,
  canEditSettings,
  canManageMembers,
  canManageProject,
} from "@/lib/permissions";
import { IssueStatus, IssuePriority, IssueType, ProjectMemberRole, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

// Helper: verify user is a project member, returns { userId, projectId }
async function requireProjectMember(projectKey: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const project = await prisma.project.findUnique({
    where: { key: projectKey.toUpperCase() },
    select: { id: true, key: true },
  });
  if (!project) throw new Error("Project not found");

  const membership = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: session.user.id, projectId: project.id } },
  });
  if (!membership) throw new Error("Not a project member");

  return { userId: session.user.id, projectId: project.id, projectKey: project.key };
}

// Helper: record an activity log entry
async function logActivity(params: {
  issueId: string;
  userId: string;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
}) {
  await prisma.activityLog.create({ data: params });
}

// --- CREATE ISSUE ---
export async function createIssue(projectKey: string, formData: {
  title: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  type?: IssueType;
  assigneeId?: string;
  labels?: string[];
}) {
  const { userId, projectId, projectKey: key } = await requireProjectMember(projectKey);

  // Count existing issues for position
  const issueCount = await prisma.issue.count({ where: { projectId } });
  const issueKey = await generateIssueKeyWithRetry(key);

  const issue = await prisma.issue.create({
    data: {
      key: issueKey,
      projectId,
      title: formData.title,
      description: formData.description ?? null,
      status: formData.status ?? IssueStatus.TODO,
      priority: formData.priority ?? IssuePriority.MEDIUM,
      type: formData.type ?? IssueType.TASK,
      assigneeId: formData.assigneeId ?? null,
      reporterId: userId,
      labels: formData.labels ?? [],
      position: issueCount,
    },
  });

  await logActivity({
    issueId: issue.id,
    userId,
    action: "created",
  });

  revalidatePath(`/projects/${projectKey}/issues`);
  revalidatePath(`/projects/${projectKey}/board`);
  return { success: true, issue };
}

// --- UPDATE ISSUE ---
export async function updateIssue(
  projectKey: string,
  issueId: string,
  updates: Partial<{
    title: string;
    description: string | null;
    status: IssueStatus;
    priority: IssuePriority;
    type: IssueType;
    assigneeId: string | null;
    labels: string[];
  }>
) {
  const { userId, projectId } = await requireProjectMember(projectKey);

  const existing = await prisma.issue.findFirst({
    where: { id: issueId, projectId },
    include: {
      assignee: { select: { name: true } },
    },
  });
  if (!existing) throw new Error("Issue not found");

  const issue = await prisma.issue.update({
    where: { id: issueId },
    data: updates,
  });

  // Log each changed field
  const fieldLabels: Record<string, string> = {
    status: "status",
    priority: "priority",
    type: "type",
    assigneeId: "assignee",
    title: "title",
    description: "description",
    labels: "labels",
  };

  for (const [field, label] of Object.entries(fieldLabels)) {
    const typedField = field as keyof typeof updates;
    if (typedField in updates && updates[typedField] !== undefined) {
      const oldRaw = existing[typedField as keyof typeof existing];
      const newRaw = updates[typedField];
      const oldValue = Array.isArray(oldRaw) ? (oldRaw as string[]).join(", ") : String(oldRaw ?? "");
      const newValue = Array.isArray(newRaw) ? (newRaw as string[]).join(", ") : String(newRaw ?? "");
      if (oldValue !== newValue) {
        await logActivity({
          issueId,
          userId,
          action: "updated",
          field: label,
          oldValue,
          newValue,
        });
      }
    }
  }

  revalidatePath(`/projects/${projectKey}/issues`);
  revalidatePath(`/projects/${projectKey}/issues/${existing.key}`);
  revalidatePath(`/projects/${projectKey}/board`);
  return { success: true, issue };
}

// --- DELETE ISSUE ---
export async function deleteIssue(projectKey: string, issueId: string) {
  const { projectId } = await requireProjectMember(projectKey);

  const issue = await prisma.issue.findFirst({
    where: { id: issueId, projectId },
  });
  if (!issue) throw new Error("Issue not found");

  await prisma.issue.delete({ where: { id: issueId } });

  revalidatePath(`/projects/${projectKey}/issues`);
  revalidatePath(`/projects/${projectKey}/board`);
  redirect(`/projects/${projectKey}/issues`);
}

// --- GET ISSUES (with filtering/sorting) ---
export type IssueFilters = {
  status?: IssueStatus;
  priority?: IssuePriority;
  type?: IssueType;
  assigneeId?: string;
  search?: string;
};

export type IssueSortField = "createdAt" | "updatedAt" | "priority";
export type SortOrder = "asc" | "desc";


export async function getIssues(
  projectKey: string,
  filters: IssueFilters = {},
  sortField: IssueSortField = "createdAt",
  sortOrder: SortOrder = "desc"
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const project = await prisma.project.findUnique({
    where: { key: projectKey.toUpperCase() },
    select: { id: true },
  });
  if (!project) throw new Error("Project not found");

  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: session.user.id, projectId: project.id } },
  });
  if (!member) throw new Error("Not a project member");

  const where: Prisma.IssueWhereInput = {
    projectId: project.id,
    ...(filters.status && { status: filters.status }),
    ...(filters.priority && { priority: filters.priority }),
    ...(filters.type && { type: filters.type }),
    ...(filters.assigneeId && { assigneeId: filters.assigneeId }),
    ...(filters.search && {
      OR: [
        { title: { contains: filters.search, mode: "insensitive" } },
        { key: { contains: filters.search, mode: "insensitive" } },
      ],
    }),
  };

  const orderBy: Prisma.IssueOrderByWithRelationInput =
    sortField === "priority"
      ? { priority: sortOrder }
      : { [sortField]: sortOrder };

  return prisma.issue.findMany({
    where,
    orderBy,
    include: {
      assignee: { select: { id: true, name: true, avatarUrl: true } },
      reporter: { select: { id: true, name: true } },
      _count: { select: { comments: true } },
    },
  });
}

// --- GET SINGLE ISSUE ---
export async function getIssue(projectKey: string, issueKey: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const project = await prisma.project.findUnique({
    where: { key: projectKey.toUpperCase() },
    select: { id: true },
  });
  if (!project) throw new Error("Project not found");

  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: session.user.id, projectId: project.id } },
  });
  if (!member) throw new Error("Not a project member");

  return prisma.issue.findUnique({
    where: { key: issueKey.toUpperCase() },
    include: {
      assignee: { select: { id: true, name: true, avatarUrl: true } },
      reporter: { select: { id: true, name: true, avatarUrl: true } },
      comments: {
        include: { author: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { createdAt: "asc" },
      },
      activityLogs: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
      project: { select: { id: true, key: true, name: true } },
    },
  });
}

// --- GET PROJECT MEMBERS (for assignee select) ---
export async function getProjectMembers(projectKey: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const project = await prisma.project.findUnique({
    where: { key: projectKey.toUpperCase() },
    select: { id: true },
  });
  if (!project) throw new Error("Project not found");

  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: session.user.id, projectId: project.id } },
  });
  if (!member) throw new Error("Not a project member");

  return prisma.projectMember.findMany({
    where: { projectId: project.id },
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
  });
}

// --- MOVE ISSUE (cross-column drag: status change + reposition) ---
export async function moveIssue(
  projectKey: string,
  issueId: string,
  newStatus: IssueStatus,
  newPosition: number
) {
  const { userId, projectId } = await requireProjectMember(projectKey);

  const existing = await prisma.issue.findFirst({
    where: { id: issueId, projectId },
    select: { id: true, status: true, position: true },
  });
  if (!existing) throw new Error("Issue not found");

  const statusChanged = existing.status !== newStatus;

  // Shift other issues in the destination column to make room
  await prisma.issue.updateMany({
    where: { projectId, status: newStatus, position: { gte: newPosition }, id: { not: issueId } },
    data: { position: { increment: 1 } },
  });

  const issue = await prisma.issue.update({
    where: { id: issueId },
    data: { status: newStatus, position: newPosition },
  });

  if (statusChanged) {
    await logActivity({
      issueId,
      userId,
      action: "updated",
      field: "status",
      oldValue: existing.status,
      newValue: newStatus,
    });
  }

  revalidatePath(`/projects/${projectKey}/board`);
  revalidatePath(`/projects/${projectKey}/issues`);
  return { success: true, issue };
}

// --- REORDER ISSUES (within-column drag) ---
export async function reorderIssues(
  projectKey: string,
  issueIds: string[]
) {
  const { projectId } = await requireProjectMember(projectKey);

  await prisma.$transaction(
    issueIds.map((id, index) =>
      prisma.issue.updateMany({
        where: { id, projectId },
        data: { position: index },
      })
    )
  );

  revalidatePath(`/projects/${projectKey}/board`);
  return { success: true };
}

// --- ADD COMMENT ---
export async function addComment(projectKey: string, issueId: string, body: string) {
  const { userId, projectId } = await requireProjectMember(projectKey);

  if (!body.trim()) throw new Error("Comment body cannot be empty");

  const issue = await prisma.issue.findFirst({
    where: { id: issueId, projectId },
    select: { id: true },
  });
  if (!issue) throw new Error("Issue not found");

  const comment = await prisma.comment.create({
    data: { issueId, authorId: userId, body: body.trim() },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });

  await logActivity({
    issueId,
    userId,
    action: "commented",
  });

  revalidatePath(`/projects/${projectKey}/issues/${issueId}`);
  return { success: true, comment };
}

// --- UPDATE COMMENT ---
export async function updateComment(
  projectKey: string,
  commentId: string,
  body: string
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: { issue: { select: { projectId: true, project: { select: { key: true } }, key: true } } },
  });
  if (!comment) throw new Error("Comment not found");
  if (comment.authorId !== session.user.id) throw new Error("Forbidden");

  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: { body: body.trim() },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });

  revalidatePath(`/projects/${projectKey}/issues/${comment.issue.key}`);
  return { success: true, comment: updated };
}

// --- DELETE COMMENT ---
export async function deleteComment(projectKey: string, commentId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: { issue: { select: { key: true } } },
  });
  if (!comment) throw new Error("Comment not found");
  if (comment.authorId !== session.user.id) throw new Error("Forbidden");

  await prisma.comment.delete({ where: { id: commentId } });

  revalidatePath(`/projects/${projectKey}/issues/${comment.issue.key}`);
  return { success: true };
}

// --- UPDATE PROJECT SETTINGS ---
export async function updateProject(
  projectKey: string,
  data: { name?: string; description?: string | null }
) {
  const { projectId } = await requireProjectRole(projectKey, canEditSettings);

  const updated = await prisma.project.update({
    where: { id: projectId },
    data,
  });

  revalidatePath(`/projects/${projectKey}/settings`);
  return { success: true, project: updated };
}

// --- DELETE PROJECT ---
export async function deleteProject(projectKey: string) {
  const { projectId } = await requireProjectRole(projectKey, canManageProject);

  await prisma.project.delete({ where: { id: projectId } });

  revalidatePath("/projects");
  redirect("/projects");
}

// --- ADD PROJECT MEMBER ---
export async function addProjectMember(
  projectKey: string,
  userId: string,
  role: ProjectMemberRole
) {
  const { projectId } = await requireProjectRole(projectKey, canManageMembers);

  // Check if user is already a member
  const existing = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  if (existing) throw new Error("User is already a project member");

  await prisma.projectMember.create({
    data: { userId, projectId, role },
  });

  revalidatePath(`/projects/${projectKey}/settings`);
  return { success: true };
}

// --- REMOVE PROJECT MEMBER ---
export async function removeProjectMember(
  projectKey: string,
  membershipId: string
) {
  const { projectId } = await requireProjectRole(projectKey, canManageMembers);

  const membership = await prisma.projectMember.findFirst({
    where: { id: membershipId, projectId },
  });
  if (!membership) throw new Error("Membership not found");
  if (membership.role === "OWNER") throw new Error("Cannot remove the project owner");

  await prisma.projectMember.delete({ where: { id: membershipId } });

  revalidatePath(`/projects/${projectKey}/settings`);
  return { success: true };
}

// --- CHANGE MEMBER ROLE ---
export async function changeMemberRole(
  projectKey: string,
  membershipId: string,
  newRole: ProjectMemberRole
) {
  const { projectId } = await requireProjectRole(projectKey, canManageMembers);

  const membership = await prisma.projectMember.findFirst({
    where: { id: membershipId, projectId },
  });
  if (!membership) throw new Error("Membership not found");
  if (membership.role === "OWNER") throw new Error("Cannot change the owner's role");

  await prisma.projectMember.update({
    where: { id: membershipId },
    data: { role: newRole },
  });

  revalidatePath(`/projects/${projectKey}/settings`);
  return { success: true };
}

// --- SEARCH USERS (for adding members) ---
export async function searchUsers(query: string, projectKey: string) {
  const { projectId } = await requireProjectRole(projectKey, canManageMembers);

  // Get existing member user IDs to exclude
  const existingMembers = await prisma.projectMember.findMany({
    where: { projectId },
    select: { userId: true },
  });
  const excludeIds = existingMembers.map((m) => m.userId);

  return prisma.user.findMany({
    where: {
      id: { notIn: excludeIds },
      OR: [
        { email: { contains: query, mode: "insensitive" } },
        { name: { contains: query, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, avatarUrl: true },
    take: 10,
  });
}

// --- CREATE USER AND ADD TO PROJECT ---
export async function createUserAndAddToProject(
  projectKey: string,
  data: { name: string; email: string; password: string; role: ProjectMemberRole }
) {
  const { projectId } = await requireProjectRole(projectKey, canManageMembers);

  // Check if email already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email },
  });
  if (existingUser) throw new Error("A user with this email already exists");

  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash,
    },
  });

  await prisma.projectMember.create({
    data: { userId: user.id, projectId, role: data.role },
  });

  revalidatePath(`/projects/${projectKey}/settings`);
  return { success: true };
}
