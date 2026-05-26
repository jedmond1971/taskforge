-- CreateTable
CREATE TABLE "IssueDocLink" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueDocLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssueDocLink_issueId_pageId_key" ON "IssueDocLink"("issueId", "pageId");

-- CreateIndex
CREATE INDEX "IssueDocLink_issueId_idx" ON "IssueDocLink"("issueId");

-- CreateIndex
CREATE INDEX "IssueDocLink_pageId_idx" ON "IssueDocLink"("pageId");

-- AddForeignKey
ALTER TABLE "IssueDocLink" ADD CONSTRAINT "IssueDocLink_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueDocLink" ADD CONSTRAINT "IssueDocLink_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "DocPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueDocLink" ADD CONSTRAINT "IssueDocLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
