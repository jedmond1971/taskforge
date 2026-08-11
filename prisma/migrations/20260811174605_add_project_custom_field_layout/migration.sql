-- CreateTable
CREATE TABLE "ProjectCustomFieldLayout" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCustomFieldLayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCustomFieldLayout_projectId_customFieldId_key" ON "ProjectCustomFieldLayout"("projectId", "customFieldId");

-- CreateIndex
CREATE INDEX "ProjectCustomFieldLayout_projectId_idx" ON "ProjectCustomFieldLayout"("projectId");

-- CreateIndex
CREATE INDEX "ProjectCustomFieldLayout_customFieldId_idx" ON "ProjectCustomFieldLayout"("customFieldId");

-- AddForeignKey
ALTER TABLE "ProjectCustomFieldLayout" ADD CONSTRAINT "ProjectCustomFieldLayout_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCustomFieldLayout" ADD CONSTRAINT "ProjectCustomFieldLayout_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
