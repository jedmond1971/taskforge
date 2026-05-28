-- Phase 2: composite indexes for position ordering queries
CREATE INDEX "Issue_projectId_status_position_idx" ON "Issue"("projectId", "status", "position");
CREATE INDEX "DocSection_docSpaceId_position_idx" ON "DocSection"("docSpaceId", "position");
CREATE INDEX "DocPage_docSpaceId_sectionId_position_idx" ON "DocPage"("docSpaceId", "sectionId", "position");
