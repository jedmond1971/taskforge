-- CreateEnum
CREATE TYPE "DocPageStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED');

-- AlterTable
ALTER TABLE "DocPage" ADD COLUMN "status" "DocPageStatus" NOT NULL DEFAULT 'PUBLISHED';

-- CreateTable
CREATE TABLE "DocPageView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocPageView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocPageView_userId_pageId_key" ON "DocPageView"("userId", "pageId");

-- CreateIndex
CREATE INDEX "DocPageView_userId_viewedAt_idx" ON "DocPageView"("userId", "viewedAt");

-- AddForeignKey
ALTER TABLE "DocPageView" ADD CONSTRAINT "DocPageView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocPageView" ADD CONSTRAINT "DocPageView_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "DocPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
