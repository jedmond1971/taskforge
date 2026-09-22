import { prisma } from "@/lib/prisma";
import { hashApiKey, generateApiKey } from "@/lib/api-keys";
import { generateAccessToken, hashOAuthSecret } from "@/lib/oauth/tokens";
import { ALL_OAUTH_SCOPES } from "@/lib/oauth/scopes";
import type { ProjectMemberRole, UserRole, OrgRole } from "@prisma/client";
import type { TestUser } from "./session";

const rand = () => Math.random().toString(36).slice(2, 8);
const letters = () =>
  Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");

async function makeUser(tag: string, label: string, role: UserRole = "TEAM_MEMBER") {
  const user = await prisma.user.create({
    data: { name: `${label} ${tag}`, email: `${tag}-${label}@itest.local`, passwordHash: "x", role },
  });
  return user;
}

async function makeProject(
  orgId: string,
  key: string,
  members: Array<[string, ProjectMemberRole]>,
  reporterId: string,
  opts: { isPublicDocs?: boolean } = {}
) {
  const project = await prisma.project.create({ data: { name: `Itest ${key}`, key, orgId } });
  const todo = await prisma.projectStatus.create({
    data: { projectId: project.id, name: "To Do", category: "TODO", position: 0, isDefault: true },
  });
  const prog = await prisma.projectStatus.create({
    data: { projectId: project.id, name: "In Progress", category: "IN_PROGRESS", position: 0, isDefault: true },
  });
  const done = await prisma.projectStatus.create({
    data: { projectId: project.id, name: "Done", category: "DONE", position: 0, isDefault: true },
  });
  const memberships: Record<string, { id: string }> = {};
  for (const [userId, role] of members) {
    memberships[userId] = await prisma.projectMember.create({ data: { userId, projectId: project.id, role } });
  }
  const issue = await prisma.issue.create({
    data: { key: `${key}-1`, projectId: project.id, title: `${key} secret issue`, statusId: todo.id, reporterId, position: 0 },
  });
  const issue2 = await prisma.issue.create({
    data: { key: `${key}-2`, projectId: project.id, title: `${key} second issue`, statusId: todo.id, reporterId, position: 1 },
  });
  const comment = await prisma.comment.create({
    data: { issueId: issue.id, authorId: reporterId, body: "<p>original comment</p>" },
  });
  const attachment = await prisma.attachment.create({
    data: {
      issueId: issue.id, uploaderId: reporterId, fileName: "a.pdf",
      fileKey: `attachments/${issue.id}/itest-a.pdf`, fileSize: 10, mimeType: "application/pdf",
    },
  });
  const docSpace = await prisma.docSpace.create({ data: { projectId: project.id, isPublic: !!opts.isPublicDocs } });
  const section = await prisma.docSection.create({ data: { docSpaceId: docSpace.id, title: "Section", position: 0 } });
  const page = await prisma.docPage.create({
    data: { docSpaceId: docSpace.id, sectionId: section.id, title: `${key} secret page`, content: "<p>secret</p>", authorId: reporterId, position: 0 },
  });
  return { project, statuses: { todo, prog, done }, memberships, issue, issue2, comment, attachment, docSpace, section, page };
}

async function makeOAuthToken(userId: string, orgId: string, clientId: string, opts: { scope?: string; expired?: boolean; revoked?: boolean } = {}) {
  const plaintext = generateAccessToken();
  await prisma.oAuthAccessToken.create({
    data: {
      hashedToken: hashOAuthSecret(plaintext),
      clientId, userId, orgId,
      scope: opts.scope ?? ALL_OAUTH_SCOPES.join(" "),
      expiresAt: new Date(Date.now() + (opts.expired ? -60_000 : 3_600_000)),
      revokedAt: opts.revoked ? new Date() : null,
    },
  });
  return plaintext;
}

/**
 * Two fully separate tenants (Org A, Org B), each with an owner + members + a project
 * that has issues, comments, an attachment and a doc space, plus org-scoped credentials.
 * Nothing links A to B; every cross-tenant test is "actor from B touches something of A".
 */
export async function createWorld() {
  const tag = rand();
  const [aOwner, aMember, aViewer, aAdmin, bOwner, bMember] = await Promise.all([
    makeUser(tag, "a-owner"), makeUser(tag, "a-member"), makeUser(tag, "a-viewer"),
    makeUser(tag, "a-admin", "ADMIN"),
    makeUser(tag, "b-owner"), makeUser(tag, "b-member"),
  ]);

  const orgA = await prisma.organization.create({ data: { name: `ItestA ${tag}`, slug: `itest-a-${tag}`, ownerId: aOwner.id } });
  const orgB = await prisma.organization.create({ data: { name: `ItestB ${tag}`, slug: `itest-b-${tag}`, ownerId: bOwner.id } });

  const orgMembers: Array<[string, string, OrgRole]> = [
    [orgA.id, aOwner.id, "OWNER"], [orgA.id, aMember.id, "MEMBER"], [orgA.id, aViewer.id, "MEMBER"], [orgA.id, aAdmin.id, "MEMBER"],
    [orgB.id, bOwner.id, "OWNER"], [orgB.id, bMember.id, "MEMBER"],
  ];
  for (const [orgId, userId, role] of orgMembers) await prisma.orgMember.create({ data: { orgId, userId, role } });

  const keyA = `ITA${letters()}`;
  const keyB = `ITB${letters()}`;
  const A = await makeProject(orgA.id, keyA, [[aOwner.id, "PROJECT_LEAD"], [aMember.id, "TEAM_MEMBER"], [aViewer.id, "VIEWER"], [aAdmin.id, "TEAM_MEMBER"]], aOwner.id);
  const B = await makeProject(orgB.id, keyB, [[bOwner.id, "PROJECT_LEAD"], [bMember.id, "TEAM_MEMBER"]], bOwner.id);

  const groupA = await prisma.group.create({ data: { orgId: orgA.id, name: `group-a-${tag}` } });
  const customFieldA = await prisma.customField.create({ data: { orgId: orgA.id, name: `field-a-${tag}`, type: "TEXT" } });

  const apiKeyAPlain = generateApiKey();
  const apiKeyBPlain = generateApiKey();
  const apiKeyRevokedPlain = generateApiKey();
  const apiKeyA = await prisma.apiKey.create({ data: { orgId: orgA.id, name: "a", keyPrefix: apiKeyAPlain.slice(0, 8), hashedKey: hashApiKey(apiKeyAPlain), createdById: aOwner.id } });
  await prisma.apiKey.create({ data: { orgId: orgB.id, name: "b", keyPrefix: apiKeyBPlain.slice(0, 8), hashedKey: hashApiKey(apiKeyBPlain), createdById: bOwner.id } });
  await prisma.apiKey.create({ data: { orgId: orgB.id, name: "revoked", keyPrefix: apiKeyRevokedPlain.slice(0, 8), hashedKey: hashApiKey(apiKeyRevokedPlain), createdById: bOwner.id, revokedAt: new Date() } });

  const client = await prisma.oAuthClient.create({ data: { clientName: `itest-${tag}`, redirectUris: ["http://localhost:9/cb"] } });
  const tokens = {
    a: await makeOAuthToken(aMember.id, orgA.id, client.id),
    b: await makeOAuthToken(bMember.id, orgB.id, client.id),
    bExpired: await makeOAuthToken(bMember.id, orgB.id, client.id, { expired: true }),
    bRevoked: await makeOAuthToken(bMember.id, orgB.id, client.id, { revoked: true }),
    bReadOnly: await makeOAuthToken(bMember.id, orgB.id, client.id, { scope: "search:read" }),
  };

  const asUser = (u: { id: string; name: string; email: string; role: string }, orgId: string): TestUser => ({
    id: u.id, name: u.name, email: u.email, role: u.role, orgId,
  });

  return {
    tag, orgA, orgB, A, B, keyA, keyB, groupA, customFieldA, apiKeyA,
    apiKeys: { a: apiKeyAPlain, b: apiKeyBPlain, bRevoked: apiKeyRevokedPlain },
    tokens, client,
    users: {
      aOwner: asUser(aOwner, orgA.id), aMember: asUser(aMember, orgA.id), aViewer: asUser(aViewer, orgA.id),
      aAdmin: asUser(aAdmin, orgA.id),
      bOwner: asUser(bOwner, orgB.id), bMember: asUser(bMember, orgB.id),
    },
  };
}

export type World = Awaited<ReturnType<typeof createWorld>>;

export async function destroyWorld(w: World) {
  const userIds = Object.values(w.users).map((u) => u.id);
  const orgIds = [w.orgA.id, w.orgB.id];
  await prisma.oAuthClient.deleteMany({ where: { id: w.client.id } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.project.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
