-- Rename MEMBER → TEAM_MEMBER in UserRole enum and add VIEWER
ALTER TYPE "UserRole" RENAME VALUE 'MEMBER' TO 'TEAM_MEMBER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'VIEWER';

-- Update User.role default to TEAM_MEMBER
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'TEAM_MEMBER'::"UserRole";

-- Create new ProjectMemberRole enum with spec-aligned values
CREATE TYPE "ProjectMemberRole_new" AS ENUM ('PROJECT_LEAD', 'TEAM_MEMBER', 'VIEWER');

-- Drop the default on ProjectMember.role before altering the column type
ALTER TABLE "ProjectMember" ALTER COLUMN "role" DROP DEFAULT;

-- Migrate data: OWNER→PROJECT_LEAD, ADMIN→PROJECT_LEAD, MEMBER→TEAM_MEMBER, VIEWER→VIEWER
ALTER TABLE "ProjectMember"
  ALTER COLUMN "role" TYPE "ProjectMemberRole_new"
  USING CASE
    WHEN "role"::text = 'OWNER'  THEN 'PROJECT_LEAD'::"ProjectMemberRole_new"
    WHEN "role"::text = 'ADMIN'  THEN 'PROJECT_LEAD'::"ProjectMemberRole_new"
    WHEN "role"::text = 'MEMBER' THEN 'TEAM_MEMBER'::"ProjectMemberRole_new"
    WHEN "role"::text = 'VIEWER' THEN 'VIEWER'::"ProjectMemberRole_new"
    ELSE 'TEAM_MEMBER'::"ProjectMemberRole_new"
  END;

-- Set new default
ALTER TABLE "ProjectMember" ALTER COLUMN "role" SET DEFAULT 'TEAM_MEMBER'::"ProjectMemberRole_new";

-- Drop old type and promote the new one
DROP TYPE "ProjectMemberRole";
ALTER TYPE "ProjectMemberRole_new" RENAME TO "ProjectMemberRole";
