-- CreateEnum
CREATE TYPE "ProjectWorkflowMode" AS ENUM ('KANBAN', 'SPRINT');

-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED');

-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'SPRINT_MANAGE';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "workflowMode" "ProjectWorkflowMode" NOT NULL DEFAULT 'KANBAN';

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN "sprintId" TEXT;

-- CreateTable
CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" "SprintStatus" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sprint_projectId_status_idx" ON "Sprint"("projectId", "status");

-- CreateIndex
CREATE INDEX "Issue_sprintId_idx" ON "Issue"("sprintId");

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- JFR-105: enforce "at most one ACTIVE sprint per project" at the DB level.
-- Non-deferrable partial unique index — startSprint does a single-row UPDATE,
-- not a multi-row reindex, so there is no legitimate transient-duplicate
-- window to defer past (unlike the DEFERRABLE Issue position constraint).
CREATE UNIQUE INDEX "Sprint_projectId_active_key" ON "Sprint"("projectId") WHERE "status" = 'ACTIVE';
