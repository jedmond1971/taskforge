-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('PROJECT_DELETE', 'PROJECT_EDIT_SETTINGS', 'PROJECT_MANAGE_MEMBERS', 'ISSUE_EDIT', 'ORG_MANAGE_CUSTOM_FIELDS', 'ORG_MANAGE_API_KEYS');

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupPermission" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,
    "projectId" TEXT,

    CONSTRAINT "GroupPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Group_orgId_idx" ON "Group"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_orgId_name_key" ON "Group"("orgId", "name");

-- CreateIndex
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");

-- CreateIndex
CREATE INDEX "GroupPermission_groupId_idx" ON "GroupPermission"("groupId");

-- CreateIndex
CREATE INDEX "GroupPermission_projectId_idx" ON "GroupPermission"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupPermission_groupId_permission_projectId_key" ON "GroupPermission"("groupId", "permission", "projectId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPermission" ADD CONSTRAINT "GroupPermission_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupPermission" ADD CONSTRAINT "GroupPermission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
