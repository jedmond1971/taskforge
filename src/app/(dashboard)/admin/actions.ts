"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { UserRole, OrgRole, Plan, ProjectMemberRole } from "@prisma/client";
import { deleteObject } from "@/lib/s3";
import { sendOrgInviteEmail, getInviteExpiryDate } from "@/lib/invites";
import { logAdminAction } from "@/lib/audit-log";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Forbidden: Admin access required");
  }
  return { userId: session.user.id };
}

// Get all users with project count
export async function getAdminUsers(search?: string) {
  await requireAdmin();
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  return prisma.user.findMany({
    where,
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      role: true,
      createdAt: true,
      _count: { select: { projectMembers: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

// Create a new user
export async function adminCreateUser(data: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}) {
  const { userId: actorId } = await requireAdmin();

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new Error("Email already in use");

  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({
    data: { name: data.name, email: data.email, passwordHash, role: data.role },
    select: { id: true, name: true, email: true, role: true },
  });

  await logAdminAction({
    actorId,
    action: "USER_CREATED",
    targetType: "User",
    targetId: user.id,
    targetLabel: user.email,
  });

  revalidatePath("/admin/users");
  return user;
}

// Update user (name, email, role)
export async function adminUpdateUser(
  userId: string,
  updates: { name?: string; email?: string; role?: UserRole }
) {
  const { userId: actorId } = await requireAdmin();

  if (updates.email) {
    const existing = await prisma.user.findFirst({
      where: { email: updates.email, NOT: { id: userId } },
    });
    if (existing) throw new Error("Email already in use");
  }

  const before = updates.role
    ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true, email: true } })
    : await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

  const user = await prisma.user.update({
    where: { id: userId },
    data: updates,
    select: { id: true, name: true, email: true, role: true },
  });

  if (updates.role && before && "role" in before) {
    await logAdminAction({
      actorId,
      action: "ROLE_CHANGED",
      targetType: "User",
      targetId: user.id,
      targetLabel: user.email,
      metadata: { from: before.role, to: updates.role },
    });
  } else if (updates.name || updates.email) {
    await logAdminAction({
      actorId,
      action: "USER_UPDATED",
      targetType: "User",
      targetId: user.id,
      targetLabel: user.email,
    });
  }

  revalidatePath("/admin/users");
  return user;
}

// Reset any user's password (admin override — no current password required)
export async function adminResetUserPassword(userId: string, newPassword: string) {
  const { userId: actorId } = await requireAdmin();

  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

  await logAdminAction({
    actorId,
    action: "PASSWORD_RESET",
    targetType: "User",
    targetId: userId,
    targetLabel: target?.email ?? userId,
  });

  revalidatePath("/admin/users");
  return { success: true };
}

// Add any user to any project (admin override)
// Ensures the user is also an OrgMember of the project's org to maintain invariants.
export async function adminAddUserToProject(
  userId: string,
  projectId: string,
  role: ProjectMemberRole
) {
  const { userId: actorId } = await requireAdmin();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { orgId: true },
  });
  if (!project) throw new Error("Project not found");

  const existing = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  if (existing) throw new Error("User is already a member of this project");

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

  await prisma.orgMember.upsert({
    where: { orgId_userId: { orgId: project.orgId, userId } },
    create: { orgId: project.orgId, userId, role: "MEMBER" },
    update: {},
  });

  await prisma.projectMember.create({ data: { userId, projectId, role } });

  await logAdminAction({
    actorId,
    action: "USER_ADDED_TO_PROJECT",
    targetType: "User",
    targetId: userId,
    targetLabel: target?.email ?? userId,
    metadata: { projectId, role },
  });

  revalidatePath("/admin/users");
  revalidatePath("/admin/projects");
  return { success: true };
}

// Lightweight project list for admin dropdowns
export async function adminGetProjectsForSelect() {
  await requireAdmin();
  return prisma.project.findMany({
    select: { id: true, name: true, key: true },
    orderBy: { name: "asc" },
  });
}

// Delete user
export async function adminDeleteUser(userId: string) {
  const { userId: actorId } = await requireAdmin();
  // Prevent deleting yourself
  const session = await auth();
  if (userId === session?.user?.id) throw new Error("Cannot delete your own account");

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

  // Pre-flight: check ON DELETE RESTRICT relations before attempting the delete
  const [orgs, reportedIssues, attachments, docPages, pageRevisions, issueDocLinks, issueLinks, orgInvites] =
    await Promise.all([
      prisma.organization.count({ where: { ownerId: userId } }),
      prisma.issue.count({ where: { reporterId: userId } }),
      prisma.attachment.count({ where: { uploaderId: userId } }),
      prisma.docPage.count({ where: { authorId: userId } }),
      prisma.pageRevision.count({ where: { authorId: userId } }),
      prisma.issueDocLink.count({ where: { createdById: userId } }),
      prisma.issueLink.count({ where: { createdById: userId } }),
      prisma.orgInvite.count({ where: { invitedById: userId } }),
    ]);

  const blockers: string[] = [];
  if (orgs > 0) blockers.push(`${orgs} ${orgs === 1 ? "organization" : "organizations"}`);
  if (reportedIssues > 0) blockers.push(`reporter on ${reportedIssues} ${reportedIssues === 1 ? "issue" : "issues"}`);
  if (attachments > 0) blockers.push(`${attachments} uploaded ${attachments === 1 ? "attachment" : "attachments"}`);
  if (docPages > 0) blockers.push(`${docPages} doc ${docPages === 1 ? "page" : "pages"}`);
  if (pageRevisions > 0) blockers.push(`${pageRevisions} doc page ${pageRevisions === 1 ? "revision" : "revisions"}`);
  if (issueDocLinks > 0) blockers.push(`${issueDocLinks} issue-doc ${issueDocLinks === 1 ? "link" : "links"}`);
  if (issueLinks > 0) blockers.push(`${issueLinks} issue ${issueLinks === 1 ? "link" : "links"}`);
  if (orgInvites > 0) blockers.push(`${orgInvites} pending org ${orgInvites === 1 ? "invite" : "invites"}`);

  if (blockers.length > 0) {
    const list = blockers.length === 1
      ? blockers[0]
      : blockers.slice(0, -1).join(", ") + ", and " + blockers[blockers.length - 1];
    throw new Error(`Can't delete this user — they own or are linked to ${list}. Reassign or resolve these first.`);
  }

  await prisma.user.delete({ where: { id: userId } });

  await logAdminAction({
    actorId,
    action: "USER_DELETED",
    targetType: "User",
    targetId: userId,
    targetLabel: target?.email ?? userId,
  });

  revalidatePath("/admin/users");
  return { success: true };
}

// Get all projects with counts
export async function getAdminProjects(search?: string) {
  await requireAdmin();
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { key: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  return prisma.project.findMany({
    where,
    select: {
      id: true,
      name: true,
      key: true,
      isClosed: true,
      createdAt: true,
      _count: { select: { members: true, issues: true } },
      members: {
        where: { role: "PROJECT_LEAD" },
        select: { user: { select: { name: true } } },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

// ─── Org actions ────────────────────────────────────────────────────────────

export async function getAdminOrgs(search?: string) {
  await requireAdmin();
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { slug: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  return prisma.organization.findMany({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      createdAt: true,
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { members: true, projects: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAdminOrgMembers(orgId: string) {
  await requireAdmin();
  return prisma.orgMember.findMany({
    where: { orgId },
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
    orderBy: { role: "asc" },
  });
}

export async function adminCreateOrg(data: {
  name: string;
  slug: string;
  plan: Plan;
  ownerId: string;
}) {
  const { userId: actorId } = await requireAdmin();

  const existing = await prisma.organization.findUnique({ where: { slug: data.slug } });
  if (existing) throw new Error("Slug already in use");

  const org = await prisma.organization.create({
    data: {
      name: data.name,
      slug: data.slug,
      plan: data.plan,
      ownerId: data.ownerId,
      members: { create: { userId: data.ownerId, role: "OWNER" } },
    },
    select: { id: true, name: true, slug: true },
  });

  await logAdminAction({
    actorId,
    action: "ORG_CREATED",
    targetType: "Organization",
    targetId: org.id,
    targetLabel: org.name,
  });

  revalidatePath("/admin/orgs");
  return org;
}

export async function adminAddOrgMember(orgId: string, userId: string, role: OrgRole) {
  const { userId: actorId } = await requireAdmin();

  const existing = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  if (existing) throw new Error("User is already a member of this org");

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });

  await prisma.orgMember.create({ data: { orgId, userId, role } });

  await logAdminAction({
    actorId,
    action: "ORG_MEMBER_ADDED",
    targetType: "Organization",
    targetId: orgId,
    targetLabel: org?.name ?? orgId,
    metadata: { addedUserId: userId, role },
  });

  revalidatePath("/admin/orgs");
  return { success: true };
}

export async function adminRemoveOrgMember(orgId: string, userId: string) {
  const { userId: actorId } = await requireAdmin();

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { ownerId: true, name: true } });
  if (org?.ownerId === userId) throw new Error("Cannot remove the org owner");

  const projectCount = await prisma.projectMember.count({
    where: { userId, project: { orgId } },
  });
  if (projectCount > 0) {
    throw new Error(
      `Cannot remove this member — they still belong to ${projectCount} project(s) in this organization. Remove them from those projects first.`
    );
  }

  await prisma.orgMember.delete({ where: { orgId_userId: { orgId, userId } } });

  await logAdminAction({
    actorId,
    action: "ORG_MEMBER_REMOVED",
    targetType: "Organization",
    targetId: orgId,
    targetLabel: org?.name ?? orgId,
    metadata: { removedUserId: userId },
  });

  revalidatePath("/admin/orgs");
  return { success: true };
}

export async function adminDeleteOrg(orgId: string) {
  const { userId: actorId } = await requireAdmin();

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, _count: { select: { projects: true } } },
  });
  if (!org) throw new Error("Organization not found");

  if (org._count.projects > 0) {
    throw new Error(
      `Cannot delete "${org.name}" — it still has ${org._count.projects} project(s). Delete or reassign all projects first.`
    );
  }

  await prisma.organization.delete({ where: { id: orgId } });

  await logAdminAction({
    actorId,
    action: "ORG_DELETED",
    targetType: "Organization",
    targetId: orgId,
    targetLabel: org.name,
  });

  revalidatePath("/admin/orgs");
  return { success: true };
}

// ─── Project actions ─────────────────────────────────────────────────────────

// Delete project (admin override - no ownership check needed)
export async function adminDeleteProject(projectId: string) {
  const { userId: actorId } = await requireAdmin();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { key: true },
  });
  if (!project) throw new Error("Project not found");

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

  await logAdminAction({
    actorId,
    action: "PROJECT_DELETED",
    targetType: "Project",
    targetId: projectId,
    targetLabel: project.key,
  });

  revalidatePath("/admin/projects");
  return { success: true };
}

// ─── Close / Reopen project ──────────────────────────────────────────────────

export async function closeProject(projectId: string) {
  const { userId: actorId } = await requireAdmin();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { key: true } });
  await prisma.project.update({ where: { id: projectId }, data: { isClosed: true } });
  await logAdminAction({
    actorId,
    action: "PROJECT_CLOSED",
    targetType: "Project",
    targetId: projectId,
    targetLabel: project?.key ?? projectId,
  });
  revalidatePath('/admin/projects');
}

export async function reopenProject(projectId: string) {
  const { userId: actorId } = await requireAdmin();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { key: true } });
  await prisma.project.update({ where: { id: projectId }, data: { isClosed: false } });
  await logAdminAction({
    actorId,
    action: "PROJECT_REOPENED",
    targetType: "Project",
    targetId: projectId,
    targetLabel: project?.key ?? projectId,
  });
  revalidatePath('/admin/projects');
}

// ─── Invite actions ───────────────────────────────────────────────────────────

export async function getAdminInvites(search?: string, orgId?: string) {
  await requireAdmin();

  const now = new Date();
  const invites = await prisma.orgInvite.findMany({
    where: {
      ...(orgId ? { orgId } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" as const } },
              { org: { name: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      email: true,
      role: true,
      accepted: true,
      acceptedAt: true,
      expiresAt: true,
      createdAt: true,
      org: { select: { id: true, name: true, slug: true } },
      invitedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return invites.map((invite) => ({
    ...invite,
    status: invite.accepted
      ? ("ACCEPTED" as const)
      : invite.expiresAt < now
        ? ("EXPIRED" as const)
        : ("PENDING" as const),
  }));
}

export async function adminGetOrgsForSelect() {
  await requireAdmin();
  return prisma.organization.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });
}

export async function adminCreateInvite(orgId: string, email: string, role: OrgRole) {
  const { userId } = await requireAdmin();

  if (role === "OWNER") throw new Error("Cannot invite with OWNER role");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email address");
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const isMember = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: existingUser.id } },
    });
    if (isMember) throw new Error("This person is already a member of this organization.");
  }

  const expiresAt = getInviteExpiryDate();

  const invite = await prisma.orgInvite.upsert({
    where: { orgId_email: { orgId, email } },
    update: {
      token: crypto.randomUUID(),
      expiresAt,
      invitedById: userId,
      accepted: false,
      acceptedAt: null,
    },
    create: {
      orgId,
      email,
      role,
      expiresAt,
      invitedById: userId,
    },
    select: { token: true, expiresAt: true },
  });

  const [org, admin] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);

  const emailResult = await sendOrgInviteEmail({
    to: email,
    orgName: org!.name,
    inviterName: admin!.name,
    token: invite.token,
    expiresAt: invite.expiresAt,
  });

  await logAdminAction({
    actorId: userId,
    action: "INVITE_CREATED",
    targetType: "OrgInvite",
    targetLabel: email,
  });

  revalidatePath("/admin/invites");

  if (!emailResult.success) {
    return { success: true, emailError: emailResult.error };
  }
  return { success: true };
}

export async function adminResendInvite(inviteId: string) {
  const { userId } = await requireAdmin();

  const existing = await prisma.orgInvite.findUnique({
    where: { id: inviteId },
    select: { accepted: true, email: true, orgId: true },
  });
  if (!existing) throw new Error("Invite not found");
  if (existing.accepted) throw new Error("Cannot resend an accepted invite");

  const expiresAt = getInviteExpiryDate();
  const invite = await prisma.orgInvite.update({
    where: { id: inviteId },
    data: { token: crypto.randomUUID(), expiresAt, invitedById: userId },
    select: { token: true, expiresAt: true, email: true, orgId: true },
  });

  const [org, admin] = await Promise.all([
    prisma.organization.findUnique({ where: { id: invite.orgId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);

  const emailResult = await sendOrgInviteEmail({
    to: invite.email,
    orgName: org!.name,
    inviterName: admin!.name,
    token: invite.token,
    expiresAt: invite.expiresAt,
  });

  await logAdminAction({
    actorId: userId,
    action: "INVITE_RESENT",
    targetType: "OrgInvite",
    targetId: inviteId,
    targetLabel: invite.email,
  });

  revalidatePath("/admin/invites");

  if (!emailResult.success) {
    return { success: true, emailError: emailResult.error };
  }
  return { success: true };
}

export async function adminRevokeInvite(inviteId: string) {
  const { userId: actorId } = await requireAdmin();

  const existing = await prisma.orgInvite.findUnique({
    where: { id: inviteId },
    select: { accepted: true, email: true },
  });
  if (!existing) throw new Error("Invite not found");
  if (existing.accepted) {
    throw new Error("Cannot revoke an accepted invite — the member is already part of the org");
  }

  await prisma.orgInvite.delete({ where: { id: inviteId } });

  await logAdminAction({
    actorId,
    action: "INVITE_REVOKED",
    targetType: "OrgInvite",
    targetId: inviteId,
    targetLabel: existing.email,
  });

  revalidatePath("/admin/invites");
  return { success: true };
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export async function getAdminAuditLog(search?: string) {
  await requireAdmin();
  const where = search
    ? {
        OR: [
          { actorName: { contains: search, mode: "insensitive" as const } },
          { actorEmail: { contains: search, mode: "insensitive" as const } },
          { targetLabel: { contains: search, mode: "insensitive" as const } },
          { action: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  return prisma.adminAuditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
