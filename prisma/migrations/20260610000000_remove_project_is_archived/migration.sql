-- Remove isArchived from Project — superseded by isClosed (TFEN-25)
ALTER TABLE "Project" DROP COLUMN IF EXISTS "isArchived";
