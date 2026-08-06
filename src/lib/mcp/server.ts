import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { IssuePriority, IssueType, Prisma, DocPageType } from "@prisma/client";
import { generateIssueKeyWithRetry } from "@/lib/issue-keys";
import { sanitizeTipTapHtml } from "@/lib/sanitize-html";
import { PRIORITY_MAP, formatIssue, resolveStatusForProject } from "@/app/api/v1/_helpers";
import { normalizeBody, TYPE_MAP, ISSUE_INCLUDE } from "@/app/api/external/v1/_helpers";
import { canEditIssues, getUserGrants } from "@/lib/permissions";
import { notificationService } from "@/lib/notifications";
import { parse, validate, executeQuery, ParseError } from "@/lib/query";
import type { OAuthTokenContext } from "@/lib/oauth/require-oauth-token";
import type { OAuthScope } from "@/lib/oauth/scopes";

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

function hasScope(ctx: OAuthTokenContext, scope: OAuthScope): boolean {
  return ctx.scope.split(/\s+/).includes(scope);
}

// Looks up a project scoped to the token's org — never by key alone, mirroring
// the external API's org-isolation rule (a globally-unique key doesn't mean a
// bearer token from org A should be able to resolve org B's project).
async function requireProjectMembership(projectKey: string, ctx: OAuthTokenContext) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase(), orgId: ctx.orgId, isClosed: false },
    select: { id: true, key: true, name: true },
  });
  if (!project) return null;

  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: ctx.userId, projectId: project.id } },
  });
  if (!member) return null;

  return { project, role: member.role };
}

// Docs are intentionally reachable on closed projects (see closed-project
// invariant #3), so this doesn't filter isClosed the way requireProjectMembership
// does. Unlike resolveDocCtx (session-based, allows non-members onto public
// docspaces), an OAuth-bearer caller must be an actual project member — least
// privilege for a token acting on a specific user's behalf.
async function requireDocContext(projectKey: string, ctx: OAuthTokenContext) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase(), orgId: ctx.orgId },
    select: { id: true },
  });
  if (!project) return null;

  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: ctx.userId, projectId: project.id } },
    select: { role: true },
  });
  if (!member) return null;

  const docSpace = await prisma.docSpace.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id },
    update: {},
    select: { id: true },
  });

  return { docSpaceId: docSpace.id, role: member.role, projectId: project.id };
}

// Looks up an issue scoped to the token's org via its project (same org-isolation
// rule as requireProjectMembership — a globally-unique issue key alone isn't
// enough to authorize a cross-org bearer token).
async function requireIssueMembership(issueKey: string, ctx: OAuthTokenContext) {
  const issue = await prisma.issue.findFirst({
    where: {
      key: issueKey.toUpperCase(),
      project: { orgId: ctx.orgId, isClosed: false },
    },
    select: {
      id: true,
      key: true,
      title: true,
      description: true,
      statusId: true,
      priority: true,
      projectId: true,
      assigneeId: true,
      reporterId: true,
      labels: true,
      dueDate: true,
      projectStatus: { select: { id: true, name: true } },
    },
  });
  if (!issue) return null;

  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: ctx.userId, projectId: issue.projectId } },
  });
  if (!member) return null;

  return { issue, role: member.role };
}

export function createMcpServer(ctx: OAuthTokenContext): McpServer {
  const server = new McpServer({ name: "jedforge", version: "1.0.0" });

  server.registerTool(
    "search_issues",
    {
      title: "Search Issues",
      description:
        'Search issues across your JedForge projects using the JedForge query language, e.g. status = "In Progress" AND assignee = currentUser().',
      inputSchema: { query: z.string().describe("JedForge query string") },
    },
    async ({ query }) => {
      if (!hasScope(ctx, "search:read")) return errorResult("Missing scope: search:read");

      let parsed;
      try {
        parsed = parse(query);
      } catch (e) {
        return errorResult(e instanceof ParseError ? `Parse error: ${e.message}` : "Failed to parse query");
      }

      const validationErrors = validate(parsed);
      if (validationErrors.length > 0) {
        return errorResult(`Invalid query: ${validationErrors.map((e) => e.message).join("; ")}`);
      }

      const memberships = await prisma.projectMember.findMany({
        where: { userId: ctx.userId, project: { orgId: ctx.orgId } },
        select: { projectId: true },
      });
      const memberProjectIds = memberships.map((m) => m.projectId);
      if (memberProjectIds.length === 0) return textResult({ issues: [], total: 0 });

      const result = await executeQuery(parsed, { userId: ctx.userId, memberProjectIds }, 50);
      return textResult(result);
    }
  );

  server.registerTool(
    "create_issue",
    {
      title: "Create Issue",
      description: "Create a new issue in a JedForge project.",
      inputSchema: {
        projectKey: z.string().describe("Project key, e.g. JFR"),
        title: z.string().describe("Issue title"),
        description: z.string().optional().describe("Plain text or TipTap HTML"),
        type: z.enum(["TASK", "BUG", "STORY", "EPIC"]).optional(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
      },
    },
    async ({ projectKey, title, description, type, priority }) => {
      if (!hasScope(ctx, "issues:write")) return errorResult("Missing scope: issues:write");

      const membership = await requireProjectMembership(projectKey, ctx);
      if (!membership) return errorResult(`Project not found or you are not a member: ${projectKey}`);
      const { project } = membership;

      const defaultStatus = await prisma.projectStatus.findFirst({
        where: { projectId: project.id, category: "TODO", isDefault: true },
        select: { id: true },
      });
      if (!defaultStatus) return errorResult("Project has no default status");

      const resolvedPriority: IssuePriority = priority ? PRIORITY_MAP[priority] : IssuePriority.MEDIUM;
      const resolvedType: IssueType = type ? TYPE_MAP[type] : IssueType.TASK;

      const issueCount = await prisma.issue.count({ where: { projectId: project.id } });

      let issue: Awaited<ReturnType<typeof prisma.issue.create>> | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        const issueKey = await generateIssueKeyWithRetry(project.key);
        try {
          issue = await prisma.issue.create({
            data: {
              key: issueKey,
              projectId: project.id,
              title: title.trim(),
              description: description ? normalizeBody(description) : null,
              statusId: defaultStatus.id,
              priority: resolvedPriority,
              type: resolvedType,
              reporterId: ctx.userId,
              labels: [],
              position: issueCount,
            },
            include: ISSUE_INCLUDE,
          });
          break;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
          throw e;
        }
      }
      if (!issue) return errorResult("Could not generate a unique issue key");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return textResult(formatIssue(issue as any));
    }
  );

  server.registerTool(
    "list_doc_pages",
    {
      title: "List Documentation Pages",
      description: "List documentation pages for a JedForge project.",
      inputSchema: { projectKey: z.string().describe("Project key, e.g. JFR") },
    },
    async ({ projectKey }) => {
      if (!hasScope(ctx, "docs:read")) return errorResult("Missing scope: docs:read");

      const docCtx = await requireDocContext(projectKey, ctx);
      if (!docCtx) return errorResult(`Project not found or docs not accessible: ${projectKey}`);

      const pages = await prisma.docPage.findMany({
        where: { docSpaceId: docCtx.docSpaceId },
        orderBy: { position: "asc" },
        select: { id: true, title: true, type: true, sectionId: true },
      });
      return textResult({ pages });
    }
  );

  server.registerTool(
    "read_doc_page",
    {
      title: "Read Documentation Page",
      description: "Read the content of a JedForge documentation page.",
      inputSchema: {
        projectKey: z.string().describe("Project key, e.g. JFR"),
        pageId: z.string(),
      },
    },
    async ({ projectKey, pageId }) => {
      if (!hasScope(ctx, "docs:read")) return errorResult("Missing scope: docs:read");

      const docCtx = await requireDocContext(projectKey, ctx);
      if (!docCtx) return errorResult(`Project not found or docs not accessible: ${projectKey}`);

      const page = await prisma.docPage.findFirst({
        where: { id: pageId, docSpaceId: docCtx.docSpaceId },
        select: { id: true, title: true, type: true, content: true },
      });
      if (!page) return errorResult("Page not found");

      return textResult(page);
    }
  );

  server.registerTool(
    "write_doc_page",
    {
      title: "Create or Update Documentation Page",
      description: "Create a new documentation page, or update an existing one when pageId is given.",
      inputSchema: {
        projectKey: z.string().describe("Project key, e.g. JFR"),
        pageId: z.string().optional().describe("Omit to create a new page"),
        title: z.string().optional().describe("Required when creating a new page"),
        content: z.string().describe("TipTap HTML content"),
      },
    },
    async ({ projectKey, pageId, title, content }) => {
      if (!hasScope(ctx, "docs:write")) return errorResult("Missing scope: docs:write");

      const docCtx = await requireDocContext(projectKey, ctx);
      if (!docCtx) return errorResult(`Project not found or docs not accessible: ${projectKey}`);
      const docGrants = await getUserGrants(ctx.userId, ctx.orgId, docCtx.projectId);
      if (!canEditIssues(docCtx.role, docGrants)) return errorResult("Forbidden: requires team member role or higher");

      const sanitized = sanitizeTipTapHtml(content);

      if (pageId) {
        const existing = await prisma.docPage.findFirst({
          where: { id: pageId, docSpaceId: docCtx.docSpaceId },
        });
        if (!existing) return errorResult("Page not found");

        const updated = await prisma.$transaction(async (tx) => {
          if (existing.content) {
            await tx.pageRevision.create({
              data: { pageId: existing.id, content: existing.content, authorId: ctx.userId },
            });
          }

          const page = await tx.docPage.update({
            where: { id: existing.id },
            data: { content: sanitized, ...(title ? { title: title.trim() } : {}) },
          });

          const revisionCount = await tx.pageRevision.count({ where: { pageId: existing.id } });
          if (revisionCount > 50) {
            const oldest = await tx.pageRevision.findMany({
              where: { pageId: existing.id },
              orderBy: { createdAt: "asc" },
              take: revisionCount - 50,
              select: { id: true },
            });
            await tx.pageRevision.deleteMany({ where: { id: { in: oldest.map((r) => r.id) } } });
          }

          return page;
        });

        return textResult({ id: updated.id, title: updated.title });
      }

      if (!title?.trim()) return errorResult("title is required when creating a new page");

      const maxPosition = await prisma.docPage.aggregate({
        where: { docSpaceId: docCtx.docSpaceId, sectionId: null },
        _max: { position: true },
      });

      const page = await prisma.docPage.create({
        data: {
          docSpaceId: docCtx.docSpaceId,
          title: title.trim(),
          type: DocPageType.NATIVE,
          content: sanitized,
          authorId: ctx.userId,
          position: (maxPosition._max.position ?? -1) + 1,
        },
      });

      return textResult({ id: page.id, title: page.title });
    }
  );

  server.registerTool(
    "update_issue",
    {
      title: "Update Issue",
      description: "Update fields on an existing JedForge issue.",
      inputSchema: {
        issueKey: z.string().describe("Issue key, e.g. JFR-103"),
        title: z.string().optional(),
        description: z.string().optional().describe("Plain text or TipTap HTML"),
        status: z.string().optional().describe('Status name (e.g. "In Progress") or status ID'),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL", "URGENT"]).optional(),
        assigneeId: z.string().nullable().optional().describe("User ID, or null to unassign"),
        labels: z.array(z.string()).optional(),
        dueDate: z.string().nullable().optional().describe("ISO date string, or null to clear"),
      },
    },
    async ({ issueKey, title, description, status, priority, assigneeId, labels, dueDate }) => {
      if (!hasScope(ctx, "issues:write")) return errorResult("Missing scope: issues:write");

      const membership = await requireIssueMembership(issueKey, ctx);
      if (!membership) return errorResult(`Issue not found or you are not a member: ${issueKey}`);
      const { issue, role } = membership;
      const issueGrants = await getUserGrants(ctx.userId, ctx.orgId, issue.projectId);
      if (!canEditIssues(role, issueGrants)) return errorResult("Forbidden: requires team member role or higher");

      const updates: Record<string, unknown> = {};
      let newStatusName: string | undefined;

      if (title !== undefined) {
        if (!title.trim()) return errorResult("title must be a non-empty string");
        updates.title = title.trim();
      }

      if (description !== undefined) {
        updates.description = sanitizeTipTapHtml(description);
      }

      if (status !== undefined) {
        const byId = await prisma.projectStatus.findFirst({
          where: { id: status, projectId: issue.projectId },
          select: { id: true, name: true },
        });
        const resolved = byId ?? (await resolveStatusForProject(issue.projectId, status));
        if (!resolved) return errorResult(`Status not found: ${status}`);
        if (resolved.id !== issue.statusId) {
          updates.statusId = resolved.id;
          newStatusName = resolved.name;
          updates.position = await prisma.issue.count({
            where: { projectId: issue.projectId, statusId: resolved.id },
          });
        }
      }

      if (priority !== undefined) {
        updates.priority = PRIORITY_MAP[priority];
      }

      if (assigneeId !== undefined) {
        if (assigneeId !== null) {
          const assigneeMember = await prisma.projectMember.findUnique({
            where: { userId_projectId: { userId: assigneeId, projectId: issue.projectId } },
          });
          if (!assigneeMember) return errorResult("Assignee is not a member of this project");
        }
        updates.assigneeId = assigneeId;
      }

      if (labels !== undefined) {
        updates.labels = labels;
      }

      if (dueDate !== undefined) {
        if (dueDate === null) {
          updates.dueDate = null;
        } else {
          const parsed = new Date(dueDate);
          if (Number.isNaN(parsed.getTime())) return errorResult("dueDate must be a valid ISO date string");
          updates.dueDate = parsed;
        }
      }

      if (Object.keys(updates).length === 0) return errorResult("No valid fields to update");

      // Log each changed field the same way the board/list UI's updateIssue action
      // does, so AI-driven edits appear in the issue's Activity tab like human edits.
      const fieldLabels: Record<string, string> = {
        title: "title",
        description: "description",
        priority: "priority",
        assigneeId: "assignee",
        labels: "labels",
        dueDate: "due date",
      };
      const logs: Array<{ field: string; oldValue: string; newValue: string }> = [];
      for (const [field, label] of Object.entries(fieldLabels)) {
        if (field in updates) {
          const oldRaw = issue[field as keyof typeof issue];
          const newRaw = updates[field];
          const oldValue = Array.isArray(oldRaw) ? oldRaw.join(", ") : String(oldRaw ?? "");
          const newValue = Array.isArray(newRaw) ? (newRaw as string[]).join(", ") : String(newRaw ?? "");
          if (oldValue !== newValue) logs.push({ field: label, oldValue, newValue });
        }
      }

      const updated = await prisma.issue.update({
        where: { id: issue.id },
        data: updates,
        include: ISSUE_INCLUDE,
      });

      if (logs.length > 0) {
        await prisma.activityLog.createMany({
          data: logs.map((l) => ({ issueId: issue.id, userId: ctx.userId, action: "updated", ...l })),
        });
      }

      if (newStatusName) {
        await prisma.activityLog.create({
          data: {
            issueId: issue.id,
            userId: ctx.userId,
            action: "updated",
            field: "status",
            oldValue: issue.projectStatus.name,
            newValue: newStatusName,
          },
        });

        await notificationService.statusChanged({
          issueKey: issue.key,
          issueTitle: issue.title,
          issueId: issue.id,
          newStatus: newStatusName,
          assigneeId: issue.assigneeId,
          reporterId: issue.reporterId,
          actorId: ctx.userId,
        });
      }

      if ("assigneeId" in updates && updates.assigneeId != null && updates.assigneeId !== issue.assigneeId) {
        await notificationService.issueAssigned({
          assigneeId: updates.assigneeId as string,
          issueKey: issue.key,
          issueTitle: issue.title,
          issueId: issue.id,
          actorId: ctx.userId,
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return textResult(formatIssue(updated as any));
    }
  );

  server.registerTool(
    "add_comment",
    {
      title: "Add Comment",
      description: "Post a comment on a JedForge issue.",
      inputSchema: {
        issueKey: z.string().describe("Issue key, e.g. JFR-103"),
        body: z.string().describe("Plain text or TipTap HTML"),
      },
    },
    async ({ issueKey, body }) => {
      if (!hasScope(ctx, "comments:write")) return errorResult("Missing scope: comments:write");

      const membership = await requireIssueMembership(issueKey, ctx);
      if (!membership) return errorResult(`Issue not found or you are not a member: ${issueKey}`);
      const { issue, role } = membership;
      const issueGrants = await getUserGrants(ctx.userId, ctx.orgId, issue.projectId);
      if (!canEditIssues(role, issueGrants)) return errorResult("Forbidden: requires team member role or higher");

      if (!body.trim()) return errorResult("body must be a non-empty string");

      const comment = await prisma.comment.create({
        data: { issueId: issue.id, authorId: ctx.userId, body: sanitizeTipTapHtml(body.trim()) },
        include: { author: { select: { id: true, name: true } } },
      });

      await prisma.activityLog.create({
        data: { issueId: issue.id, userId: ctx.userId, action: "commented" },
      });

      await notificationService.commentAdded({
        issueKey: issue.key,
        issueTitle: issue.title,
        issueId: issue.id,
        assigneeId: issue.assigneeId,
        reporterId: issue.reporterId,
        actorId: ctx.userId,
      });

      return textResult({
        id: comment.id,
        body: comment.body,
        authorId: comment.authorId,
        author: comment.author,
        createdAt: comment.createdAt,
      });
    }
  );

  return server;
}
