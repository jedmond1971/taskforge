import { prisma } from "@/lib/prisma";
import { ProjectMemberRole } from "@prisma/client";

export type DocCtx = {
  projectId: string;
  docSpaceId: string;
  /** null when the user is a non-member accessing a public docspace (read-only) */
  role: ProjectMemberRole | null;
  isPublic: boolean;
};

/**
 * Resolves a project's docspace context for a given user.
 *
 * - Members: returns their role + upserts the docspace.
 * - Non-members on a public docspace: returns role=null.
 * - Non-members on a private docspace: returns null (access denied).
 */
export async function resolveDocCtx(
  projectKey: string,
  userId: string
): Promise<DocCtx | null> {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase() },
    select: { id: true },
  });
  if (!project) return null;

  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId: project.id } },
    select: { role: true },
  });

  if (!member) {
    const docSpace = await prisma.docSpace.findUnique({
      where: { projectId: project.id },
      select: { id: true, isPublic: true },
    });
    if (!docSpace?.isPublic) return null;
    return { projectId: project.id, docSpaceId: docSpace.id, isPublic: true, role: null };
  }

  const docSpace = await prisma.docSpace.upsert({
    where: { projectId: project.id },
    create: { projectId: project.id },
    update: {},
    select: { id: true, isPublic: true },
  });

  return {
    projectId: project.id,
    docSpaceId: docSpace.id,
    isPublic: docSpace.isPublic,
    role: member.role,
  };
}
