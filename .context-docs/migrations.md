# Database migrations

For local dev (Docker Postgres on port 5433): `npx prisma migrate dev`

Always update `prisma/schema.prisma` and let Prisma generate the migration with `npx prisma migrate dev`. Run `npx prisma generate` after schema changes.

**`npx prisma migrate dev` requires an interactive TTY** — it will fail with "non-interactive environment" in Claude Code's shell. Workaround for simple DDL migrations (add/drop column, create index): manually create the migration directory and SQL file under `prisma/migrations/<timestamp>_<name>/migration.sql`, apply it with psql directly, then record it in the migrations table:
```bash
psql postgresql://postgres:postgres@localhost:5433/taskforge -f prisma/migrations/<dir>/migration.sql
psql postgresql://postgres:postgres@localhost:5433/taskforge -c \
  "INSERT INTO \"_prisma_migrations\" (id, checksum, started_at, finished_at, migration_name, applied_steps_count) \
   VALUES (gen_random_uuid(), 'manual', now(), now(), '<migration_name>', 1) ON CONFLICT DO NOTHING;"
npx prisma generate
```
Production picks up the migration automatically via `prisma migrate deploy` in `railway.toml`.

**Production migrations are auto-applied on every Railway deploy.** `railway.toml` sets `preDeployCommand = "npx prisma migrate deploy"`, which runs before the app starts. No manual psql step is needed — just push and Railway handles it.

**`Board` and `Column` models were dropped (JFR-107, 2026-08-11)** — they were dead code (`prisma.board`/`prisma.column` were never called anywhere in `src/`). The Kanban view is driven entirely by `ProjectStatus` rows.
