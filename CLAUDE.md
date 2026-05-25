# TaskForge / JedForge — Codebase Notes

## Organization tenancy invariants

Every project belongs to exactly one organization, and every user-to-project relationship must be valid inside that organization. JedForge is a multi-tenant product where each client organization experiences the app as its own instance.

**Rules enforced in code:**

1. **Registration** (`src/app/api/auth/register/route.ts`) — Creating a `User` also creates a default `Organization` and an OWNER `OrgMember` in the same transaction.
2. **Project member search** (`searchUsers`) — Only returns users who are `OrgMember`s of the project's org and are not already project members.
3. **Adding a project member** (`addProjectMember`) — Validates that the target user has an `OrgMember` row for the project's org before creating the `ProjectMember`.
4. **Creating a user from project settings** (`createUserAndAddToProject`) — Creates `User`, `OrgMember`, and `ProjectMember` in one transaction.
5. **Issue assignees** (`createIssue`, `updateIssue`) — Assignee must have a `ProjectMember` row for the same project. Null/unassigned always allowed.
6. **Admin org deletion** (`adminDeleteOrg`) — Blocked if the org has any projects. No silent cascade.
7. **Admin org-member removal** (`adminRemoveOrgMember`) — Blocked if the user still has `ProjectMember` rows in that org. Do not cascade-delete project memberships.

**Non-goals (do not implement without a separate product decision):**
Org switching UI, full invite system, billing changes, broad project membership role redesign, cascading project deletion on org delete.

---

## UI component library

This project uses **`@base-ui/react`** (NOT Radix UI). Standard shadcn components that depend on Radix do not exist here. Custom equivalents are built on Base UI primitives.

- `src/components/ui/confirm-dialog.tsx` — use for all destructive action confirmations (not `window.confirm()`)
- `src/components/ui/rich-text-editor.tsx` — TipTap v2 editor
- `src/components/ui/rich-text-display.tsx` — read-only HTML renderer for TipTap content

See @docs/rich-text.md for TipTap packages, storage format, and empty-state behavior.

---

## Adding npm packages

The bash sandbox cannot access the local project, so `npm install` cannot be run from within a Cowork session. To add packages:
1. Edit `package.json` manually.
2. Ask Jamie to run `npm install` locally to update `package-lock.json`.
3. Commit both files and push. Railway uses `npm ci` which requires the lockfile to be in sync.

---

## Database migrations

```bash
psql "$(railway variables --service Postgres --json | python3 -c "import sys,json; print(json.load(sys.stdin)['DATABASE_PUBLIC_URL'])")" -f prisma/migrations/<name>/migration.sql
```

For local dev (Docker Postgres on port 5433): `npx prisma migrate dev`

Always write the migration SQL manually into `prisma/migrations/<timestamp_name>/migration.sql` and update `prisma/schema.prisma` in the same commit. Run `npx prisma generate` after schema changes.

---

## Internal v1 REST API

An internal API for Claude Code to track work in JedForge. No authentication required.

- **Local:** `http://localhost:3000/api/v1`
- **Production:** `https://taskforge-production-099b.up.railway.app/api/v1`
- **Reference:** see `CLAUDE_API.md` for full route docs and working convention

Routes: `GET/POST /api/v1/issues`, `GET/PATCH/DELETE /api/v1/issues/[key]`, `GET /api/v1/projects`, `GET /api/v1/projects/[id]`

**Schema notes:** `IssueStatus` and `IssuePriority` are enums, not database tables. Priority values are `CRITICAL | HIGH | MEDIUM | LOW` (URGENT is accepted as an alias for CRITICAL). Statuses are synthesised from the enum in API responses.

**Create an issue at the start of every non-trivial task.** See `CLAUDE_API.md` → Working Convention.

---

## Local dev environment

- Docker Postgres on port 5433 — start with `docker start taskforge-db` if not running
- Railway CLI auth is broken in this environment (interactive login hangs, browserless produces no output). Workaround: curl the production URL directly. Fix: generate a token at railway.app → Account Settings → Tokens and use `RAILWAY_TOKEN=<token>` or `railway login --token <token>`. (Tracked: TFEN-19)
- Production URL: `https://taskforge-production-099b.up.railway.app` — `jedforge.com` has no DNS records

---

## Reference docs (load when relevant)

- .context-docs/rich-text.md — TipTap packages, HTML storage, empty-state normalization
- .context-docs/notifications.md — trigger points, known gaps, UI entry points, server actions
- .context-docs/avatars.md — S3 upload, proxy route, session refresh
- .context-docs/shortcuts.md — global and project-context keyboard shortcuts
- .context-docs/roadmap-workflow.md — JFR project workflow for roadmap items
