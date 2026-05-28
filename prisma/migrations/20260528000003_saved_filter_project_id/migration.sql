-- Phase 7: SavedFilter — add projectId to scope filters per project (fixes cross-tenant leak)

ALTER TABLE "SavedFilter" ADD COLUMN "projectId" TEXT;

-- Best-effort: assign projectId from the first project the user is a member of.
-- In practice SavedFilter rows are few; orphaned rows (users with no project) are deleted.
UPDATE "SavedFilter" sf
SET "projectId" = (
  SELECT pm."projectId"
  FROM "ProjectMember" pm
  WHERE pm."userId" = sf."userId"
  LIMIT 1
)
WHERE sf."projectId" IS NULL;

DELETE FROM "SavedFilter" WHERE "projectId" IS NULL;

ALTER TABLE "SavedFilter" ALTER COLUMN "projectId" SET NOT NULL;

ALTER TABLE "SavedFilter" ADD CONSTRAINT "SavedFilter_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "SavedFilter_projectId_idx" ON "SavedFilter"("projectId");
