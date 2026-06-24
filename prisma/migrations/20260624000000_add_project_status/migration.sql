-- Migration: add_project_status
-- Replaces the hardcoded IssueStatus enum with a per-project ProjectStatus table.
-- Each project gets 5 seeded statuses; existing Issue rows are linked by name match.

-- 1. New StatusCategory enum (3 fixed categories)
CREATE TYPE "StatusCategory" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');

-- 2. ProjectStatus table
CREATE TABLE "ProjectStatus" (
  "id"        TEXT         NOT NULL,
  "projectId" TEXT         NOT NULL,
  "name"      TEXT         NOT NULL,
  "category"  "StatusCategory" NOT NULL,
  "position"  INTEGER      NOT NULL,
  "isDefault" BOOLEAN      NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT "ProjectStatus_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectStatus_projectId_name_key" UNIQUE ("projectId", "name"),
  CONSTRAINT "ProjectStatus_projectId_fkey" FOREIGN KEY ("projectId")
    REFERENCES "Project"("id") ON DELETE CASCADE
);
CREATE INDEX "ProjectStatus_projectId_category_position_idx"
  ON "ProjectStatus"("projectId", "category", "position");

-- 3. Seed 5 statuses for every existing project
--    (gen_random_uuid()::text used since Prisma cuid() is not available in SQL)
INSERT INTO "ProjectStatus"("id","projectId","name","category","position","isDefault","createdAt","updatedAt")
  SELECT gen_random_uuid()::text, p."id", 'To Do', 'TODO', 0, true, NOW(), NOW()
  FROM "Project" p;

INSERT INTO "ProjectStatus"("id","projectId","name","category","position","isDefault","createdAt","updatedAt")
  SELECT gen_random_uuid()::text, p."id", 'In Progress', 'IN_PROGRESS', 0, true, NOW(), NOW()
  FROM "Project" p;

INSERT INTO "ProjectStatus"("id","projectId","name","category","position","isDefault","createdAt","updatedAt")
  SELECT gen_random_uuid()::text, p."id", 'In Review', 'IN_PROGRESS', 1, false, NOW(), NOW()
  FROM "Project" p;

INSERT INTO "ProjectStatus"("id","projectId","name","category","position","isDefault","createdAt","updatedAt")
  SELECT gen_random_uuid()::text, p."id", 'Done', 'DONE', 0, true, NOW(), NOW()
  FROM "Project" p;

INSERT INTO "ProjectStatus"("id","projectId","name","category","position","isDefault","createdAt","updatedAt")
  SELECT gen_random_uuid()::text, p."id", 'Cancelled', 'DONE', 1, false, NOW(), NOW()
  FROM "Project" p;

-- 4. Add nullable statusId column to Issue
ALTER TABLE "Issue" ADD COLUMN "statusId" TEXT;

-- 5. Populate Issue.statusId by matching the old status enum value to the seeded status name
UPDATE "Issue" i
SET "statusId" = ps."id"
FROM "ProjectStatus" ps
WHERE ps."projectId" = i."projectId"
  AND ps."name" = CASE i."status"
    WHEN 'TODO'        THEN 'To Do'
    WHEN 'IN_PROGRESS' THEN 'In Progress'
    WHEN 'IN_REVIEW'   THEN 'In Review'
    WHEN 'DONE'        THEN 'Done'
    WHEN 'CANCELLED'   THEN 'Cancelled'
  END;

-- 6. Make statusId NOT NULL and add FK
ALTER TABLE "Issue" ALTER COLUMN "statusId" SET NOT NULL;
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_statusId_fkey"
  FOREIGN KEY ("statusId") REFERENCES "ProjectStatus"("id");

-- 7. Drop old DEFERRABLE position constraint and related indexes
ALTER TABLE "Issue" DROP CONSTRAINT IF EXISTS "Issue_projectId_status_position_key";
DROP INDEX IF EXISTS "Issue_status_idx";
DROP INDEX IF EXISTS "Issue_projectId_status_position_idx";

-- 8. Add new DEFERRABLE position constraint and indexes scoped to statusId
CREATE INDEX "Issue_statusId_idx" ON "Issue"("statusId");
CREATE INDEX "Issue_projectId_statusId_position_idx" ON "Issue"("projectId", "statusId", "position");
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_projectId_statusId_position_key"
  UNIQUE ("projectId", "statusId", "position") DEFERRABLE INITIALLY DEFERRED;

-- 9. Drop old status column and IssueStatus enum
ALTER TABLE "Issue" DROP COLUMN "status";
DROP TYPE "IssueStatus";
