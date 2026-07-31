-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();

-- Backfill: updatedAt is the best available proxy for existing issues' last status change.
UPDATE "Issue" SET "statusChangedAt" = "updatedAt";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "doneAutoHideDays" INTEGER;
