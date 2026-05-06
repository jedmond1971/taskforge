/**
 * One-off script: create a single user in the database.
 *
 * Usage (with DATABASE_URL pointing at the target database):
 *
 *   DATABASE_URL="..." \
 *   ADMIN_EMAIL="you@example.com" \
 *   ADMIN_PASSWORD="yourpassword" \
 *   ADMIN_NAME="Your Name" \
 *   npx tsx scripts/create-user.ts
 *
 * ROLE defaults to ADMIN. Set ADMIN_ROLE=MEMBER to create a regular user.
 * Safe to run multiple times — skips creation if email already exists.
 */

import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "Admin";
  const role = (process.env.ADMIN_ROLE as UserRole) ?? UserRole.ADMIN;

  if (!email || !password) {
    console.error("Error: ADMIN_EMAIL and ADMIN_PASSWORD env vars are required.");
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`User already exists: ${email} (id: ${existing.id}) — no changes made.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, name, passwordHash, role },
  });

  console.log(`Created user: ${user.email} (id: ${user.id}, role: ${user.role})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
