import { prisma } from "@/lib/prisma";
import { Prisma, ProjectMemberRole } from "@prisma/client";

/**
 * Prisma's upsert() isn't atomic against a genuine concurrent-insert race: two
 * requests can both miss the `where` lookup and both attempt `create`, and the
 * loser hits a unique-constraint violation (P2002) instead of falling through
 * to `update`. This became reachable in normal usage once Next.js started
 * prefetching visible nav links more eagerly (Next 16 upgrade, SECH-81),
 * which fires a concurrent request racing the user's own navigation on a
 * DocSpace's first-ever lazy-create. Retry once as a plain fetch on P2002.
 */
export async function upsertDocSpaceSafe<T extends Prisma.DocSpaceUpsertArgs>(
  args: Prisma.SelectSubset<T, Prisma.DocSpaceUpsertArgs>
): Promise<Prisma.DocSpaceGetPayload<T>> {
  try {
    return (await prisma.docSpace.upsert(args)) as Prisma.DocSpaceGetPayload<T>;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return (await prisma.docSpace.findUniqueOrThrow({
        where: args.where,
        select: args.select,
        include: args.include,
      } as Prisma.DocSpaceFindUniqueOrThrowArgs)) as Prisma.DocSpaceGetPayload<T>;
    }
    throw err;
  }
}

export type DocCtx = {
  projectId: string;
  orgId: string;
  docSpaceId: string;
  /** null when the user is a non-member accessing a public docspace (read-only) */
  role: ProjectMemberRole | null;
  isPublic: boolean;
  isClosed: boolean;
};

/**
 * Resolves a project's docspace context for a given user.
 *
 * - Members: returns their role + upserts the docspace.
 * - Non-members in the project's organization, on a public docspace: returns role=null.
 * - Anyone else (private docspace, or a user outside the owning org): returns null.
 *
 * "Public" means public to the owning organization, never across tenants
 * (SECH-95): each org experiences JedForge as its own instance.
 */
export async function resolveDocCtx(
  projectKey: string,
  userId: string
): Promise<DocCtx | null> {
  const project = await prisma.project.findFirst({
    where: { key: projectKey.toUpperCase() },
    select: { id: true, orgId: true, isClosed: true },
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
    const orgMember = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: project.orgId, userId } },
      select: { id: true },
    });
    if (!orgMember) return null;
    return {
      projectId: project.id,
      orgId: project.orgId,
      docSpaceId: docSpace.id,
      isPublic: true,
      role: null,
      isClosed: project.isClosed,
    };
  }

  const docSpace = await upsertDocSpaceSafe({
    where: { projectId: project.id },
    create: { projectId: project.id },
    update: {},
    select: { id: true, isPublic: true },
  });

  return {
    projectId: project.id,
    orgId: project.orgId,
    docSpaceId: docSpace.id,
    isPublic: docSpace.isPublic,
    role: member.role,
    isClosed: project.isClosed,
  };
}

/**
 * Docs remain readable on a closed project (closed-project invariant #3) but
 * not writable, mirroring the read-only UI gate in the docs page components
 * (`readOnly = isClosed || !canEditIssues`). Admins bypass, same as the
 * session-layer write-lock in requireProjectRole (SECH-93).
 */
export function isDocsWriteLocked(isClosed: boolean, isPlatformAdmin: boolean): boolean {
  return isClosed && !isPlatformAdmin;
}
