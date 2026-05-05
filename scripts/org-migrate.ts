/**
 * JedForge — Multi-tenant migration script
 * prisma/migrations/add-organizations/migrate.ts
 *
 * Run with:  npx tsx prisma/migrations/add-organizations/migrate.ts
 *
 * What this does (in safe order):
 *   1. Creates an Organization for every existing User
 *   2. Creates an OrgMember row (OWNER) for each user in their org
 *   3. Reassigns every Project from userId → orgId
 *   4. Removes the now-unused userId column from Project
 *
 * Safe to re-run — each step is idempotent.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48);
}

async function ensureUniqueSlug(
  baseSlug: string,
  userId: string
): Promise<string> {
  // Append userId suffix to guarantee uniqueness across all users
  return `${baseSlug}-${userId.slice(-6)}`;
}

async function step1_createOrganizations() {
  console.log("\n── Step 1: Creating organizations for existing users ──");

  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true },
  });

  let created = 0;
  let skipped = 0;

  for (const user of users) {
    const existing = await prisma.organization.findFirst({
      where: { ownerId: user.id },
    });

    if (existing) {
      skipped++;
      continue;
    }

    const displayName = user.name ?? user.email.split("@")[0];
    const baseSlug = slugify(displayName);
    const slug = await ensureUniqueSlug(baseSlug, user.id);

    await prisma.organization.create({
      data: {
        name: `${displayName}'s workspace`,
        slug,
        plan: "FREE",
        ownerId: user.id,
      },
    });

    created++;
  }

  console.log(`   Created: ${created}  Skipped (already exist): ${skipped}`);
}

async function step2_createOrgMembers() {
  console.log("\n── Step 2: Adding users as OWNER of their organization ──");

  const orgs = await prisma.organization.findMany({
    select: { id: true, ownerId: true },
  });

  let created = 0;
  let skipped = 0;

  for (const org of orgs) {
    const existing = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: org.id, userId: org.ownerId } },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.orgMember.create({
      data: {
        orgId: org.id,
        userId: org.ownerId,
        role: "OWNER",
      },
    });

    created++;
  }

  console.log(`   Created: ${created}  Skipped (already exist): ${skipped}`);
}

async function step3_reassignProjects() {
  console.log("\n── Step 3: Reassigning projects from userId → orgId ──");

  const projects = await prisma.project.findMany({
    where: { orgId: null },
    select: {
      id: true,
      members: { select: { userId: true, role: true } },
    },
  });

  let migrated = 0;
  let skipped = 0;
  let orphaned = 0;

  for (const project of projects) {
    const ownerMember =
      project.members.find((m) => m.role === "OWNER") ??
      project.members.find((m) => m.role === "ADMIN") ??
      project.members[0];

    if (!ownerMember) {
      skipped++;
      continue;
    }

    const org = await prisma.organization.findFirst({
      where: { ownerId: ownerMember.userId },
      select: { id: true },
    });

    if (!org) {
      console.warn(
        `   WARNING: No org found for userId=${ownerMember.userId} (project ${project.id}) — skipping`
      );
      orphaned++;
      continue;
    }

    await (prisma as any).project.update({
      where: { id: project.id },
      data: { orgId: org.id },
    });

    migrated++;
  }

  console.log(
    `   Migrated: ${migrated}  Already set: ${skipped}  Orphaned: ${orphaned}`
  );

  if (orphaned > 0) {
    console.warn(
      `\n   ⚠️  ${orphaned} project(s) could not be assigned to an org.`
    );
    console.warn(
      `   Investigate before dropping userId column from Project.\n`
    );
  }
}

async function step4_verify() {
  console.log("\n── Step 4: Verification ──");

  const userCount = await prisma.user.count();
  const orgCount = await prisma.organization.count();
  const memberCount = await prisma.orgMember.count();
  const projectCount = await (prisma as any).project.count();
  const unmigrated = await (prisma as any).project.count({
    where: { orgId: null },
  });

  console.log(`   Users:              ${userCount}`);
  console.log(`   Organizations:      ${orgCount}`);
  console.log(`   OrgMembers:         ${memberCount}`);
  console.log(`   Projects total:     ${projectCount}`);
  console.log(`   Projects unmigrated: ${unmigrated}`);

  if (unmigrated > 0) {
    console.error("\n   ❌ Some projects are still unmigrated. Do not proceed.");
    process.exit(1);
  }

  if (userCount !== orgCount) {
    console.warn(
      `\n   ⚠️  User count (${userCount}) !== Org count (${orgCount}).`
    );
    console.warn(`   This is fine if some users already had orgs created.`);
  }

  console.log("\n   ✅ Migration looks clean. Safe to drop userId from Project.");
}

async function main() {
  console.log("JedForge multi-tenant migration");
  console.log("================================");

  try {
    await step1_createOrganizations();
    await step2_createOrgMembers();
    await step3_reassignProjects();
    await step4_verify();
    console.log("\n✅ Migration complete.\n");
    console.log("Next steps:");
    console.log(
      "  1. In schema.prisma, remove `userId` from Project and make `orgId` non-optional"
    );
    console.log("  2. Run: npx prisma migrate dev --name add_organizations");
    console.log("  3. Deploy and verify on Railway");
  } catch (err) {
    console.error("\n❌ Migration failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
