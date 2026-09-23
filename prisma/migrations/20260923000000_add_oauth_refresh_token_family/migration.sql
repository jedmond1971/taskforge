-- SECH-109: refresh-token family lineage for RFC 9700 reuse detection.
-- Existing rows each become their own family root; nothing is revoked by this migration.
ALTER TABLE "OAuthRefreshToken" ADD COLUMN "familyId" TEXT;
UPDATE "OAuthRefreshToken" SET "familyId" = "id" WHERE "familyId" IS NULL;
ALTER TABLE "OAuthRefreshToken" ALTER COLUMN "familyId" SET NOT NULL;

CREATE INDEX "OAuthRefreshToken_familyId_idx" ON "OAuthRefreshToken"("familyId");
