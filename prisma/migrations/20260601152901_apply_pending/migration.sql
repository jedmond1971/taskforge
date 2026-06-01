-- no-op: position uniqueness constraints are managed by raw SQL in
-- 20260601000000_position_uniqueness/migration.sql and intentionally not
-- reflected as @@unique in schema.prisma (Option B — deferrable constraint).
-- Prisma generates this cleanup migration as drift; it is safe to skip.
SELECT 1;
