-- CreateEnum
CREATE TYPE "DocPageType" AS ENUM ('NATIVE', 'DOCUMENT');

-- CreateTable
CREATE TABLE "DocSpace" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocSpace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocSection" (
    "id" TEXT NOT NULL,
    "docSpaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocPage" (
    "id" TEXT NOT NULL,
    "docSpaceId" TEXT NOT NULL,
    "sectionId" TEXT,
    "title" TEXT NOT NULL,
    "type" "DocPageType" NOT NULL DEFAULT 'NATIVE',
    "content" TEXT,
    "fileKey" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "authorId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageRevision" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocSpace_projectId_key" ON "DocSpace"("projectId");

-- CreateIndex
CREATE INDEX "DocSection_docSpaceId_idx" ON "DocSection"("docSpaceId");

-- CreateIndex
CREATE INDEX "DocPage_docSpaceId_idx" ON "DocPage"("docSpaceId");

-- CreateIndex
CREATE INDEX "DocPage_sectionId_idx" ON "DocPage"("sectionId");

-- CreateIndex
CREATE INDEX "DocPage_authorId_idx" ON "DocPage"("authorId");

-- CreateIndex
CREATE INDEX "PageRevision_pageId_idx" ON "PageRevision"("pageId");

-- AddForeignKey
ALTER TABLE "DocSpace" ADD CONSTRAINT "DocSpace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocSection" ADD CONSTRAINT "DocSection_docSpaceId_fkey" FOREIGN KEY ("docSpaceId") REFERENCES "DocSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocPage" ADD CONSTRAINT "DocPage_docSpaceId_fkey" FOREIGN KEY ("docSpaceId") REFERENCES "DocSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocPage" ADD CONSTRAINT "DocPage_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "DocSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocPage" ADD CONSTRAINT "DocPage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageRevision" ADD CONSTRAINT "PageRevision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "DocPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageRevision" ADD CONSTRAINT "PageRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
