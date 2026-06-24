"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  requireProjectRole,
  requireAdmin,
  canEditIssues,
  canEditSettings,
  canManageMembers,
  canManageProject,
} from "@/lib/permissions";
import { IssuePriority, IssueType, IssueLinkType, ProjectMemberRole, StatusCategory, Prisma } from "@prisma/client";
import { CATEGORY_ORDER } from "@/lib/issue-utils";
import bcrypt from "bcryptjs";
import { notificationService } from "@/lib/notifications";
import { sanitizeTipTapHtml } from "@/lib/sanitize-html";
import { deleteObject } from "@/lib/s3";

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
  statusId?: string;
  priority?: IssuePriority;
  type?: IssueType;
  assigneeId?: string;
  labels?: string[];
  dueDate?: Date | null;
  parentId?: string | null;
}) {
  const { userId, projectId, projectKey: key } = await requireProjectRole(projectKey, canEditIssues);

  if (formData.assigneeId) {
    const assigneeMember = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: formData.assigneeId, projectId } },
    });
    if (!assigneeMember) throw new Error("Assignee is not a member of this project");
  }

  const sanitizedDescription = formData.description != null
    ? sanitizeTipTapHtml(formData.description)
    : null;

  // Advisory lock: SELECT ... FOR UPDATE on the Project row serialises concurrent
  // issue creates for this project, eliminating the TOCTOU race in key generation.
  const issue = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;

    let statusId = formData.statusId;
    if (!statusId) {
      const defaultStatus = await tx.projectStatus.findFirst({
        where: { projectId, category: "TODO", isDefault: true },
        select: { id: true },
      });
      if (!defaultStatus) throw new Error("No default status found for project");
      statusId = defaultStatus.id;
    }

    const issueCount = await tx.issue.count({ where: { projectId } });

    const lastIssue = await tx.issue.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: { key: true },
    });
    const lastNum = lastIssue ? parseInt(lastIssue.key.split("-")[1], 10) : 0;
    const issueKey = `${key}-${lastNum + 1}`;

    return tx.issue.create({
      data: {
        key: issueKey,
        projectId,
        title: formData.title,
        description: sanitizedDescription,
        statusId,
        priority: formData.priority ?? IssuePriority.MEDIUM,
        type: formData.type ?? IssueType.TASK,
        assigneeId: formData.assigneeId ?? null,
        reporterId: userId,
        labels: formData.labels ?? [],
        position: issueCount,
        dueDate: formData.dueDate ?? null,
        parentId: formData.parentId ?? null,
      },
      include: {
        projectStatus: { select: { id: true, name: true, category: true } },
      },
    });
  });

  await logActivity({
    issueId: issue.id,
    userId,
    action: "created",
  });

  if (issue.assigneeId) {
    await notificationService.issueAssigned({
      assigneeId: issue.assigneeId,
      issueKey: issue.key,
      issueTitle: issue.title,
      issueId: issue.id,
      actorId: userId,
    });
  }

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
    statusId: string;
    priority: IssuePriority;
    type: IssueType;
    assigneeId: string | null;
    labels: string[];
    dueDate: Date | null;
  }>
) {
  const { userId, projectId } = await requireProjectRole(projectKey, canEditIssues);

  if (updates.assigneeId != null) {
    const assigneeMember = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: updates.assigneeId, projectId } },
    });
    if (!assigneeMember) throw new Error("Assignee is not a member of this project");
  }

  const existing = await prisma.issue.findFirst({
    where: { id: issueId, projectId },
    include: {
      assignee: { select: { name: true } },
      projectStatus: { select: { id: true, name: true } },
    },
  });
  if (!existing) throw new Error("Issue not found");

  if (typeof updates.description === "string") {
    updates.description = sanitizeTipTapHtml(updates.description);
  }

  const issue = await prisma.issue.update({
    where: { id: issueId },
    data: updates,
    include: { projectStatus: { select: { id: true, name: true, category: true } } },
  });

  // Log each changed field (statusId handled separately below)
  const fieldLabels: Record<string, string> = {
    priority: "priority",
    type: "type",
    assigneeId: "assignee",
    title: "title",
    description: "description",
    labels: "labels",
    dueDate: "due date",
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

  // Log status change using human-readable names
  if ("statusId" in updates && updates.statusId !== undefined && updates.statusId !== existing.statusId) {
    await logActivity({
      issueId,
      userId,
      action: "updated",
      field: "status",
      oldValue: existing.projectStatus.name,
      newValue: issue.projectStatus.name,
    });

    await notificationService.statusChanged({
      issueKey: existing.key,
      issueTitle: existing.title,
      issueId: issueId,
      newStatus: issue.projectStatus.name,
      assigneeId: existing.assigneeId,
      reporterId: existing.reporterId,
      actorId: userId,
    });
  }

  if (
    "assigneeId" in updates &&
    updates.assigneeId != null &&
    updates.assigneeId !== existing.assigneeId
  ) {
    await notificationService.issueAssigned({
      assigneeId: updates.assigneeId,
      issueKey: existing.key,
      issueTitle: existing.title,
      issueId: issueId,
      actorId: userId,
    });
  }

  revalidatePath(`/projects/${projectKey}/issues`);
  revalidatePath(`/projects/${projectKey}/issues/${existing.key}`);
  revalidatePath(`/projects/${projectKey}/board`);
  return { success: true, issue };
}

// --- DELETE ISSUE ---
export async function deleteIssue(projectKey: string, issueId: string) {
  const { projectId } = await requireProjectRole(projectKey, canEditIssues);

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
  statusId?: string;
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
    ...(filters.statusId && { statusId: filters.statusId }),
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
      projectStatus: { select: { id: true, name: true, category: true } },
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

  return prisma.issue.findFirst({
    where: { key: issueKey.toUpperCase(), projectId: project.id },
    include: {
      projectStatus: { select: { id: true, name: true, category: true } },
      assignee: { select: { id: true, name: true, avatarUrl: true } },
      reporter: { select: { id: true, name: true, avatarUrl: true } },
      parent: { select: { id: true, key: true, title: true, projectStatus: { select: { id: true, name: true, category: true } } } },
      children: {
        select: {
          id: true,
          key: true,
          title: true,
          projectStatus: { select: { id: true, name: true, category: true } },
          priority: true,
          assignee: { select: { id: true, name: true, avatarUrl: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      comments: {
        include: { author: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { createdAt: "asc" },
      },
      activityLogs: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
      project: { select: { id: true, key: true, name: true } },
      docLinks: {
        include: {
          page: { select: { id: true, title: true, type: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      outgoingLinks: {
        include: {
          targetIssue: {
            select: {
              id: true,
              key: true,
              title: true,
              projectStatus: { select: { id: true, name: true, category: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      incomingLinks: {
        include: {
          sourceIssue: {
            select: {
              id: true,
              key: true,
              title: true,
              projectStatus: { select: { id: true, name: true, category: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

// --- DOC LINK MANAGEMENT ---
export async function linkDocPage(projectKey: string, issueId: string, pageId: string) {
  const { userId, projectId } = await requireProjectMember(projectKey);

  // Verify issue belongs to this project
  const issue = await prisma.issue.findFirst({
    where: { id: issueId, projectId },
    select: { id: true },
  });
  if (!issue) throw new Error("Issue not found");

  // Verify page belongs to this project's doc space
  const docSpace = await prisma.docSpace.findUnique({
    where: { projectId },
    select: { id: true },
  });
  if (!docSpace) throw new Error("Doc space not found");

  const page = await prisma.docPage.findFirst({
    where: { id: pageId, docSpaceId: docSpace.id },
    select: { id: true },
  });
  if (!page) throw new Error("Page not found");

  await prisma.issueDocLink.upsert({
    where: { issueId_pageId: { issueId, pageId } },
    create: { issueId, pageId, createdById: userId },
    update: {},
  });

  revalidatePath(`/projects/${projectKey}/issues`);
}

export async function unlinkDocPage(projectKey: string, issueId: string, pageId: string) {
  const { projectId } = await requireProjectMember(projectKey);

  const issue = await prisma.issue.findFirst({
    where: { id: issueId, projectId },
    select: { id: true },
  });
  if (!issue) throw new Error("Issue not found");

  await prisma.issueDocLink.deleteMany({ where: { issueId, pageId } });

  revalidatePath(`/projects/${projectKey}/issues`);
}

// --- ISSUE LINK MANAGEMENT ---

export async function searchIssuesForLinking(projectKey: string, query: string, excludeIssueId: string) {
  const { projectId } = await requireProjectMember(projectKey);

  const issues = await prisma.issue.findMany({
    where: {
      projectId,
      id: { not: excludeIssueId },
      OR: [
        { key: { contains: query.toUpperCase() } },
        { title: { contains: query, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      key: true,
      title: true,
      projectStatus: { select: { id: true, name: true, category: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return issues;
}

export async function linkIssue(
  projectKey: string,
  sourceIssueId: string,
  targetIssueId: string,
  linkType: IssueLinkType
) {
  const { userId, projectId } = await requireProjectMember(projectKey);

  // Verify both issues belong to this project
  const [source, target] = await Promise.all([
    prisma.issue.findFirst({ where: { id: sourceIssueId, projectId }, select: { id: true } }),
    prisma.issue.findFirst({ where: { id: targetIssueId, projectId }, select: { id: true } }),
  ]);
  if (!source || !target) throw new Error("Issue not found");

  await prisma.issueLink.create({
    data: { sourceIssueId, targetIssueId, linkType, createdById: userId },
  });

  revalidatePath(`/projects/${projectKey}/issues`);
}

export async function unlinkIssue(projectKey: string, linkId: string) {
  const { projectId } = await requireProjectMember(projectKey);

  // Verify the link belongs to this project via the source issue
  const link = await prisma.issueLink.findFirst({
    where: { id: linkId, sourceIssue: { projectId } },
    select: { id: true },
  });
  if (!link) throw new Error("Link not found");

  await prisma.issueLink.delete({ where: { id: linkId } });

  revalidatePath(`/projects/${projectKey}/issues`);
}

// --- GET PROJECT STATUSES (for status dropdowns, accessible to all members) ---
export async function getProjectStatuses(projectKey: string) {
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

  const statuses = await prisma.projectStatus.findMany({
    where: { projectId: project.id },
  });

  return statuses.sort((a, b) => {
    const catDiff = CATEGORY_ORDER[a.category as StatusCategory] - CATEGORY_ORDER[b.category as StatusCategory];
    return catDiff !== 0 ? catDiff : a.position - b.position;
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
  newStatusId: string,
  newPosition: number
) {
  const { userId, projectId } = await requireProjectRole(projectKey, canEditIssues);

  try {
    const { issue, oldStatusId, oldStatusName, newStatusName } = await prisma.$transaction(async (tx) => {
      // Lock project row to serialise concurrent moves for this project
      await tx.$executeRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;

      const existing = await tx.issue.findFirst({
        where: { id: issueId, projectId },
        select: { id: true, statusId: true, projectStatus: { select: { name: true } } },
      });
      if (!existing) throw new Error("Issue not found");

      const oldStatusId = existing.statusId;
      const oldStatusName = existing.projectStatus.name;
      const statusChanged = oldStatusId !== newStatusId;

      const newStatusRecord = await tx.projectStatus.findUnique({
        where: { id: newStatusId },
        select: { name: true },
      });
      if (!newStatusRecord) throw new Error("Target status not found");

      // Build the new destination column order: others + moved issue at clamped pos
      const destOthers = await tx.issue.findMany({
        where: { projectId, statusId: newStatusId, id: { not: issueId } },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      const clamped = Math.max(0, Math.min(newPosition, destOthers.length));
      const destOrder = [
        ...destOthers.slice(0, clamped),
        { id: issueId },
        ...destOthers.slice(clamped),
      ];

      // Update moved issue status then reindex entire destination column
      await tx.issue.update({ where: { id: issueId }, data: { statusId: newStatusId } });
      for (let i = 0; i < destOrder.length; i++) {
        await tx.issue.update({ where: { id: destOrder[i].id }, data: { position: i } });
      }

      if (statusChanged) {
        // Reindex source column now that the issue has left
        const srcIssues = await tx.issue.findMany({
          where: { projectId, statusId: oldStatusId },
          orderBy: { position: "asc" },
          select: { id: true },
        });
        for (let i = 0; i < srcIssues.length; i++) {
          await tx.issue.update({ where: { id: srcIssues[i].id }, data: { position: i } });
        }
      }

      const updatedIssue = await tx.issue.findUniqueOrThrow({
        where: { id: issueId },
        include: { projectStatus: { select: { id: true, name: true, category: true } } },
      });
      return { issue: updatedIssue, oldStatusId, oldStatusName, newStatusName: newStatusRecord.name };
    });

    if (oldStatusId !== newStatusId) {
      await logActivity({
        issueId,
        userId,
        action: "updated",
        field: "status",
        oldValue: oldStatusName,
        newValue: newStatusName,
      });
    }

    revalidatePath(`/projects/${projectKey}/board`);
    revalidatePath(`/projects/${projectKey}/issues`);
    return { success: true, issue };
  } catch (error) {
    console.error("moveIssue position write failed:", error);
    throw new Error("Failed to move issue — please retry");
  }
}

// --- REORDER ISSUES (within-column drag) ---
export async function reorderIssues(
  projectKey: string,
  issueIds: string[]
) {
  const { projectId } = await requireProjectRole(projectKey, canEditIssues);

  try {
    await prisma.$transaction(
      issueIds.map((id, index) =>
        prisma.issue.updateMany({
          where: { id, projectId },
          data: { position: index },
        })
      )
    );
  } catch (error) {
    console.error("reorderIssues position write failed:", error);
    throw new Error("Failed to reorder issues — please retry");
  }

  revalidatePath(`/projects/${projectKey}/board`);
  return { success: true };
}

// --- ADD COMMENT ---
export async function addComment(projectKey: string, issueId: string, body: string) {
  const { userId, projectId } = await requireProjectMember(projectKey);

  if (!body.trim()) throw new Error("Comment body cannot be empty");

  const issue = await prisma.issue.findFirst({
    where: { id: issueId, projectId },
    select: { id: true, key: true, title: true, assigneeId: true, reporterId: true },
  });
  if (!issue) throw new Error("Issue not found");

  const comment = await prisma.comment.create({
    data: { issueId, authorId: userId, body: sanitizeTipTapHtml(body.trim()) },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });

  await logActivity({
    issueId,
    userId,
    action: "commented",
  });

  await notificationService.commentAdded({
    issueKey: issue.key,
    issueTitle: issue.title,
    issueId: issue.id,
    assigneeId: issue.assigneeId,
    reporterId: issue.reporterId,
    actorId: userId,
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
    data: { body: sanitizeTipTapHtml(body.trim()) },
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

  const attachments = await prisma.attachment.findMany({
    where: { issue: { projectId } },
    select: { fileKey: true },
  });

  const docPages = await prisma.docPage.findMany({
    where: {
      docSpace: { projectId },
      fileKey: { not: null },
    },
    select: { fileKey: true },
  });

  const keysToDelete = [
    ...attachments.map((a) => a.fileKey),
    ...docPages.map((p) => p.fileKey as string),
  ];

  for (const key of keysToDelete) {
    try {
      await deleteObject(key);
    } catch (e) {
      console.error(`Failed to delete S3 object ${key}:`, e);
    }
  }

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
  const { projectId, orgId } = await requireProjectRole(projectKey, canManageMembers);

  const orgMembership = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  if (!orgMembership) throw new Error("User is not a member of this organization");

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
  if (membership.role === "PROJECT_LEAD") throw new Error("Cannot remove a project lead");

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
  if (membership.role === "PROJECT_LEAD") throw new Error("Cannot change a project lead's role");

  await prisma.projectMember.update({
    where: { id: membershipId },
    data: { role: newRole },
  });

  revalidatePath(`/projects/${projectKey}/settings`);
  return { success: true };
}

// --- SEARCH USERS (for adding members) ---
export async function searchUsers(query: string, projectKey: string) {
  const { projectId, orgId } = await requireProjectRole(projectKey, canManageMembers);

  const existingMembers = await prisma.projectMember.findMany({
    where: { projectId },
    select: { userId: true },
  });
  const excludeIds = existingMembers.map((m) => m.userId);

  // Only surface users who are already in the project's org
  const orgMembers = await prisma.orgMember.findMany({
    where: { orgId, userId: { notIn: excludeIds } },
    select: { userId: true },
  });
  const orgMemberIds = orgMembers.map((m) => m.userId);

  return prisma.user.findMany({
    where: {
      id: { in: orgMemberIds },
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
  const { projectId, orgId } = await requireProjectRole(projectKey, canManageMembers);

  const existingUser = await prisma.user.findUnique({
    where: { email: data.email },
  });
  if (existingUser) throw new Error("A user with this email already exists");

  const passwordHash = await bcrypt.hash(data.password, 12);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: data.name, email: data.email, passwordHash },
    });

    await tx.orgMember.create({
      data: { orgId, userId: user.id, role: "MEMBER" },
    });

    await tx.projectMember.create({
      data: { userId: user.id, projectId, role: data.role },
    });
  });

  revalidatePath(`/projects/${projectKey}/settings`);
  return { success: true };
}

// --- SET PROJECT PRIVACY --- (Admin only per spec Section 2)
export async function setProjectPrivacy(projectKey: string, isPrivate: boolean) {
  await requireAdmin();

  const project = await prisma.project.findUnique({
    where: { key: projectKey.toUpperCase() },
    select: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await prisma.project.update({
    where: { id: project.id },
    data: { isPrivate },
  });

  revalidatePath(`/projects/${projectKey}/settings`);
  return { success: true };
}

export async function getIssuesHierarchy(projectKey: string) {
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

  return prisma.issue.findMany({
    where: { projectId: project.id },
    select: {
      id: true,
      key: true,
      title: true,
      projectStatus: { select: { id: true, name: true, category: true } },
      priority: true,
      type: true,
      parentId: true,
      assignee: { select: { id: true, name: true, avatarUrl: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}
