-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'CHECKBOX', 'SELECT', 'MULTI_SELECT');

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldProject" (
    "id" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "CustomFieldProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldValue" (
    "id" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "textValue" TEXT,
    "numberValue" DOUBLE PRECISION,
    "dateValue" TIMESTAMP(3),
    "boolValue" BOOLEAN,
    "selectValue" TEXT,
    "multiValues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_orgId_name_key" ON "CustomField"("orgId", "name");

-- CreateIndex
CREATE INDEX "CustomField_orgId_idx" ON "CustomField"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldProject_customFieldId_projectId_key" ON "CustomFieldProject"("customFieldId", "projectId");

-- CreateIndex
CREATE INDEX "CustomFieldProject_customFieldId_idx" ON "CustomFieldProject"("customFieldId");

-- CreateIndex
CREATE INDEX "CustomFieldProject_projectId_idx" ON "CustomFieldProject"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldValue_customFieldId_issueId_key" ON "CustomFieldValue"("customFieldId", "issueId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_issueId_idx" ON "CustomFieldValue"("issueId");

-- CreateIndex
CREATE INDEX "CustomFieldValue_customFieldId_idx" ON "CustomFieldValue"("customFieldId");

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldProject" ADD CONSTRAINT "CustomFieldProject_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldProject" ADD CONSTRAINT "CustomFieldProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldValue" ADD CONSTRAINT "CustomFieldValue_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
