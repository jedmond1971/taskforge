-- Phase 6: ActivityLog — make userId nullable (SET NULL on user delete)
-- issueId already has ON DELETE CASCADE; userId had CASCADE which would destroy
-- audit history when a user is deleted. Change to SET NULL to preserve the log.

ALTER TABLE "ActivityLog" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "ActivityLog" DROP CONSTRAINT IF EXISTS "ActivityLog_userId_fkey";
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
