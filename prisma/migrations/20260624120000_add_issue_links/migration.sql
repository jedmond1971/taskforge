-- CreateEnum
CREATE TYPE "IssueLinkType" AS ENUM ('BLOCKS', 'RELATES_TO');

-- CreateTable
CREATE TABLE "IssueLink" (
    "id" TEXT NOT NULL,
    "sourceIssueId" TEXT NOT NULL,
    "targetIssueId" TEXT NOT NULL,
    "linkType" "IssueLinkType" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssueLink_sourceIssueId_targetIssueId_linkType_key" ON "IssueLink"("sourceIssueId", "targetIssueId", "linkType");

-- CreateIndex
CREATE INDEX "IssueLink_sourceIssueId_idx" ON "IssueLink"("sourceIssueId");

-- CreateIndex
CREATE INDEX "IssueLink_targetIssueId_idx" ON "IssueLink"("targetIssueId");

-- AddForeignKey
ALTER TABLE "IssueLink" ADD CONSTRAINT "IssueLink_sourceIssueId_fkey" FOREIGN KEY ("sourceIssueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueLink" ADD CONSTRAINT "IssueLink_targetIssueId_fkey" FOREIGN KEY ("targetIssueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueLink" ADD CONSTRAINT "IssueLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
