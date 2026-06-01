-- Enforce position uniqueness on Issue, DocSection, and DocPage.
--
-- All Issue and DocSection constraints are DEFERRABLE INITIALLY DEFERRED because
-- the Kanban reorder logic (moveIssue, reorderIssues) updates position columns
-- sequentially within a single transaction, temporarily creating duplicate
-- values that resolve before commit. A standard INITIALLY IMMEDIATE constraint
-- would fire mid-transaction on the first duplicate write.
--
-- DocPage sectioned-page constraint is also DEFERRABLE for consistency and future
-- safety. DocPage top-level pages use a non-deferrable partial unique index
-- because PostgreSQL does not support deferrable partial indexes; no multi-row
-- reorder exists for DocPage, so immediate checking is safe.

-- ================================================================
-- Step 1: Deduplicate existing data before adding constraints
-- ================================================================

-- Issue: positions are scoped to (projectId, status).
-- Find rows where (projectId, status, position) is duplicated, keep the
-- earliest by createdAt, and reassign duplicates to positions > 1,000,000.
WITH dupes AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "projectId", "status", position
           ORDER BY "createdAt"
         ) AS dupe_rn,
         ROW_NUMBER() OVER (ORDER BY id) AS unique_seq
  FROM "Issue"
)
UPDATE "Issue"
SET position = 1000000 + dupes.unique_seq
FROM dupes
WHERE "Issue".id = dupes.id AND dupes.dupe_rn > 1;

-- DocSection: positions are scoped to docSpaceId.
WITH dupes AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "docSpaceId", position
           ORDER BY "createdAt"
         ) AS dupe_rn,
         ROW_NUMBER() OVER (ORDER BY id) AS unique_seq
  FROM "DocSection"
)
UPDATE "DocSection"
SET position = 1000000 + dupes.unique_seq
FROM dupes
WHERE "DocSection".id = dupes.id AND dupes.dupe_rn > 1;

-- DocPage (sectioned pages): positions within each section.
WITH dupes AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "sectionId", position
           ORDER BY "createdAt"
         ) AS dupe_rn,
         ROW_NUMBER() OVER (ORDER BY id) AS unique_seq
  FROM "DocPage"
  WHERE "sectionId" IS NOT NULL
)
UPDATE "DocPage"
SET position = 1000000 + dupes.unique_seq
FROM dupes
WHERE "DocPage".id = dupes.id AND dupes.dupe_rn > 1;

-- DocPage (top-level pages): positions within each docSpace where sectionId IS NULL.
WITH dupes AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "docSpaceId", position
           ORDER BY "createdAt"
         ) AS dupe_rn,
         ROW_NUMBER() OVER (ORDER BY id) AS unique_seq
  FROM "DocPage"
  WHERE "sectionId" IS NULL
)
UPDATE "DocPage"
SET position = 2000000 + dupes.unique_seq
FROM dupes
WHERE "DocPage".id = dupes.id AND dupes.dupe_rn > 1;

-- ================================================================
-- Step 2: Add unique constraints
-- ================================================================

-- Issue: DEFERRABLE unique on (projectId, status, position).
-- Scoped to status because each Kanban column maintains its own
-- 0-based position sequence independently of other columns.
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_projectId_status_position_key"
  UNIQUE ("projectId", "status", position)
  DEFERRABLE INITIALLY DEFERRED;

-- DocSection: DEFERRABLE unique on (docSpaceId, position).
ALTER TABLE "DocSection" ADD CONSTRAINT "DocSection_docSpaceId_position_key"
  UNIQUE ("docSpaceId", position)
  DEFERRABLE INITIALLY DEFERRED;

-- DocPage (sectioned pages): DEFERRABLE unique on (sectionId, position).
-- Rows with NULL sectionId are excluded from this constraint (NULL != NULL
-- in standard unique semantics), so it enforces uniqueness only within
-- each section. Top-level pages are handled by the partial index below.
ALTER TABLE "DocPage" ADD CONSTRAINT "DocPage_sectionId_position_key"
  UNIQUE ("sectionId", position)
  DEFERRABLE INITIALLY DEFERRED;

-- DocPage (top-level pages): non-deferrable partial unique index.
-- Enforces unique position among pages with no section, per docSpace.
-- PostgreSQL does not support deferrable partial indexes; no multi-row
-- reorder exists for DocPage so immediate checking is safe.
CREATE UNIQUE INDEX "DocPage_docSpaceId_position_null_key"
  ON "DocPage" ("docSpaceId", position)
  WHERE "sectionId" IS NULL;
