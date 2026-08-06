"use server";

import { prisma } from "@/lib/prisma";
import { requireOrgRole, canManageGroups } from "@/lib/permissions";
import type { Permission } from "@prisma/client";

// Org-level permissions can only ever be granted org-wide (projectId: null) —
// there's no such thing as a project-scoped API-key or custom-field grant.
const ORG_SCOPED_PERMISSIONS: Permission[] = ["ORG_MANAGE_CUSTOM_FIELDS", "ORG_MANAGE_API_KEYS"];

export type GroupMemberRow = { id: string; userId: string; name: string; email: string };
export type GroupGrantRow = {
  id: string;
  permission: Permission;
  projectId: string | null;
  projectName: string | null;
};
export type GroupRow = {
  id: string;
  name: string;
  createdAt: string;
  members: GroupMemberRow[];
  grants: GroupGrantRow[];
};

function toGroupRow(group: {
  id: string;
  name: string;
  createdAt: Date;
  members: { id: string; userId: string; user: { name: string; email: string } }[];
  grants: { id: string; permission: Permission; projectId: string | null; project: { name: string } | null }[];
}): GroupRow {
  return {
    id: group.id,
    name: group.name,
    createdAt: group.createdAt.toISOString(),
    members: group.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
    })),
    grants: group.grants.map((g) => ({
      id: g.id,
      permission: g.permission,
      projectId: g.projectId,
      projectName: g.project?.name ?? null,
    })),
  };
}

const GROUP_INCLUDE = {
  members: { include: { user: { select: { name: true, email: true } } } },
  grants: { include: { project: { select: { name: true } } } },
} as const;

export async function listGroups(orgId: string): Promise<GroupRow[]> {
  await requireOrgRole(orgId, canManageGroups);

  const groups = await prisma.group.findMany({
    where: { orgId },
    include: GROUP_INCLUDE,
    orderBy: { name: "asc" },
  });

  return groups.map(toGroupRow);
}

export async function getOrgProjectsForGroups(orgId: string) {
  await requireOrgRole(orgId, canManageGroups);

  return prisma.project.findMany({
    where: { orgId },
    select: { id: true, name: true, key: true },
    orderBy: { name: "asc" },
  });
}

export async function searchOrgMembersForGroup(orgId: string, groupId: string, query: string) {
  await requireOrgRole(orgId, canManageGroups);

  const existingMembers = await prisma.groupMember.findMany({
    where: { groupId },
    select: { userId: true },
  });
  const excludeIds = existingMembers.map((m) => m.userId);

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

export async function createGroup(
  orgId: string,
  name: string
): Promise<{ success: true; group: GroupRow } | { success: false; error: string }> {
  await requireOrgRole(orgId, canManageGroups);

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Name is required" };
  if (trimmed.length > 100) return { success: false, error: "Name must be 100 characters or fewer" };

  const existing = await prisma.group.findUnique({ where: { orgId_name: { orgId, name: trimmed } } });
  if (existing) return { success: false, error: "A group with this name already exists" };

  const created = await prisma.group.create({
    data: { orgId, name: trimmed },
    include: GROUP_INCLUDE,
  });

  return { success: true, group: toGroupRow(created) };
}

export async function renameGroup(
  orgId: string,
  groupId: string,
  name: string
): Promise<{ success: true } | { success: false; error: string }> {
  await requireOrgRole(orgId, canManageGroups);

  const trimmed = name.trim();
  if (!trimmed) return { success: false, error: "Name is required" };
  if (trimmed.length > 100) return { success: false, error: "Name must be 100 characters or fewer" };

  const group = await prisma.group.findFirst({ where: { id: groupId, orgId } });
  if (!group) return { success: false, error: "Group not found" };

  const existing = await prisma.group.findUnique({ where: { orgId_name: { orgId, name: trimmed } } });
  if (existing && existing.id !== groupId) {
    return { success: false, error: "A group with this name already exists" };
  }

  await prisma.group.update({ where: { id: groupId }, data: { name: trimmed } });
  return { success: true };
}

export async function deleteGroup(
  orgId: string,
  groupId: string
): Promise<{ success: true } | { success: false; error: string }> {
  await requireOrgRole(orgId, canManageGroups);

  const group = await prisma.group.findFirst({ where: { id: groupId, orgId } });
  if (!group) return { success: false, error: "Group not found" };

  await prisma.group.delete({ where: { id: groupId } });
  return { success: true };
}

// Mirrors addProjectMember's tenancy check (projects/[projectKey]/actions.ts):
// a Group can only ever boost an existing OrgMember, never grant org access.
export async function addGroupMember(
  orgId: string,
  groupId: string,
  userId: string
): Promise<{ success: true } | { success: false; error: string }> {
  await requireOrgRole(orgId, canManageGroups);

  const group = await prisma.group.findFirst({ where: { id: groupId, orgId } });
  if (!group) return { success: false, error: "Group not found" };

  const orgMembership = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
  });
  if (!orgMembership) return { success: false, error: "User is not a member of this organization" };

  const existing = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (existing) return { success: false, error: "User is already in this group" };

  await prisma.groupMember.create({ data: { groupId, userId } });
  return { success: true };
}

export async function removeGroupMember(
  orgId: string,
  groupId: string,
  userId: string
): Promise<{ success: true } | { success: false; error: string }> {
  await requireOrgRole(orgId, canManageGroups);

  const group = await prisma.group.findFirst({ where: { id: groupId, orgId } });
  if (!group) return { success: false, error: "Group not found" };

  await prisma.groupMember.deleteMany({ where: { groupId, userId } });
  return { success: true };
}

export async function setGroupPermission(
  orgId: string,
  groupId: string,
  permission: Permission,
  projectId: string | null
): Promise<{ success: true; grant: GroupGrantRow } | { success: false; error: string }> {
  await requireOrgRole(orgId, canManageGroups);

  const group = await prisma.group.findFirst({ where: { id: groupId, orgId } });
  if (!group) return { success: false, error: "Group not found" };

  if (projectId && ORG_SCOPED_PERMISSIONS.includes(permission)) {
    return { success: false, error: "This permission is org-wide and cannot be scoped to a project" };
  }

  if (projectId) {
    const project = await prisma.project.findFirst({ where: { id: projectId, orgId } });
    if (!project) return { success: false, error: "Project not found in this organization" };
  }

  // Postgres treats each NULL as distinct, so the @@unique([groupId, permission, projectId])
  // constraint doesn't dedupe org-wide (projectId: null) grants — check first.
  const existing = await prisma.groupPermission.findFirst({ where: { groupId, permission, projectId } });
  if (existing) {
    const project = projectId ? await prisma.project.findUnique({ where: { id: projectId } }) : null;
    return {
      success: true,
      grant: { id: existing.id, permission, projectId, projectName: project?.name ?? null },
    };
  }

  const created = await prisma.groupPermission.create({
    data: { groupId, permission, projectId },
    include: { project: { select: { name: true } } },
  });

  return {
    success: true,
    grant: {
      id: created.id,
      permission: created.permission,
      projectId: created.projectId,
      projectName: created.project?.name ?? null,
    },
  };
}

export async function removeGroupPermission(
  orgId: string,
  grantId: string
): Promise<{ success: true } | { success: false; error: string }> {
  await requireOrgRole(orgId, canManageGroups);

  const grant = await prisma.groupPermission.findFirst({
    where: { id: grantId, group: { orgId } },
  });
  if (!grant) return { success: false, error: "Grant not found" };

  await prisma.groupPermission.delete({ where: { id: grantId } });
  return { success: true };
}
