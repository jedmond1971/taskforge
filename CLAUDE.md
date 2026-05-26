# TaskForge / JedForge — Codebase Notes

## Session workflow

### Startup checklist (run at the beginning of every session)
1. `git status` — confirm the working tree is clean before starting. Commit or stash any pre-existing changes first.
2. `docker start taskforge-db 2>/dev/null; docker ps --filter name=taskforge-db --format "{{.Status}}"` — confirm Postgres is running.
3. Find or create a JedForge issue for the work ahead. Check the relevant project (JFDOCS, TFEN, JFR) for an existing issue before creating a new one. See `CLAUDE_API.md` → Working Convention.

### Pre-commit checklist (run before every commit)
1. `npm run lint` — zero errors required. Pre-existing warnings are acceptable; new ones are not.
2. `npx tsc --noEmit` — zero type errors required.
3. `git diff --name-only --cached` — verify only files changed in this session are staged.

### After pushing
Monitor CI to completion before closing the session:
```bash
until gh run list --repo jedmond1971/taskforge --limit 1 2>&1 | grep -qE "completed|failure|success"; do sleep 5; done
gh run list --repo jedmond1971/taskforge --limit 1
```
If CI fails, fix and push before ending the session. Do not leave main in a broken state.

**Railway deploy lag:** CI passing does not mean the production deployment is live. Railway takes an additional ~2–3 minutes after CI success to build and swap the deployment. New API routes will 404 until the deploy completes. If you need to verify a new endpoint is live, poll with `until curl -s -o /dev/null -w "%{http_code}" <url> | grep -q "200"; do sleep 15; done`.

### End-of-session CLAUDE.md update
Before closing every session, review what was discovered and update this file. Add only durable facts that will matter in future sessions — environment quirks, schema discoveries, tooling workarounds, corrected URLs. Do not add summaries of completed work.

---

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
8. **Admin add-user-to-project** (`adminAddUserToProject`) — Admin override that upserts an `OrgMember` (MEMBER role) for the project's org if the user isn't already in it, then creates `ProjectMember`. This is the only place the org-membership pre-check is bypassed; it is replaced by an upsert so the invariant is still satisfied after the call.

**Non-goals (do not implement without a separate product decision):**
Org switching UI, full invite system, billing changes, broad project membership role redesign, cascading project deletion on org delete.

---

## UI component library

This project uses **`@base-ui/react`** (NOT Radix UI). Standard shadcn components that depend on Radix do not exist here. Custom equivalents are built on Base UI primitives.

- `src/components/ui/confirm-dialog.tsx` — use for all destructive action confirmations (not `window.confirm()`)
- `src/components/ui/rich-text-editor.tsx` — TipTap v2 editor
- `src/components/ui/rich-text-display.tsx` — read-only HTML renderer for TipTap content

See `.context-docs/rich-text.md` for TipTap packages, storage format, and empty-state behavior.

---

## Adding npm packages

Claude Code cannot run `npm install` directly. To add packages:
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

**Production migrations are NOT auto-applied on deploy.** The `start` script is plain `next start` — there is no `prisma migrate deploy` in the build pipeline. Every migration must be applied to the production database manually with the psql command above before (or immediately after) pushing. Railway's `npm ci` triggers `@prisma/client`'s postinstall hook which auto-generates the client, so `prisma generate` is handled automatically on deploy — but the SQL schema change is not.

**Before writing any route or server action that queries Prisma, verify every field referenced exists in the current `schema.prisma`.** If a field is absent, note it and either adapt the query or plan a migration before proceeding.

---

## Internal v1 REST API

An internal API for Claude Code to track work in JedForge. No authentication required.

- **Local:** `http://localhost:3000/api/v1`
- **Production:** `https://taskforge-production-099b.up.railway.app/api/v1`
- **Reference:** see `CLAUDE_API.md` for full route docs and working convention

Routes: `GET/POST /api/v1/issues`, `GET/PATCH/DELETE /api/v1/issues/[key]`, `GET/POST /api/v1/issues/[key]/comments`, `PATCH/DELETE /api/v1/issues/[key]/comments/[commentId]`, `GET /api/v1/projects`, `GET /api/v1/projects/[id]`

To update an issue after completing work, use `PATCH /api/v1/issues/[key]` with `statusId` (not `status`) to mark it done. To post a comment, use `POST /api/v1/issues/[key]/comments` with `body` and `authorId`. Use `cmo365psl000vdrd0p63lirlz` as `authorId` to post as Maximus (Claude Code account). See `CLAUDE_API.md` for the full comments API.

**Schema notes:** `IssueStatus` and `IssuePriority` are enums, not database tables. Priority values are `CRITICAL | HIGH | MEDIUM | LOW` (URGENT is accepted as an alias for CRITICAL). Statuses are synthesised from the enum in API responses.

**Create an issue at the start of every non-trivial task.** See `CLAUDE_API.md` → Working Convention.

---

## Local dev environment

- Docker Postgres on port 5433 — start with `docker start taskforge-db` if not running (see startup checklist above)
- Railway CLI auth is broken in this environment (interactive login hangs, browserless produces no output). Workaround: curl the production URL directly. Fix: generate a token at railway.app → Account Settings → Tokens and use `RAILWAY_TOKEN=<token>` or `railway login --token <token>`. (Tracked: TFEN-19)
- Production URL: `https://taskforge-production-099b.up.railway.app` — `jedforge.com` has no DNS records

---

## Docs module invariants

The Docs module lives under `src/app/(dashboard)/projects/[projectKey]/docs/` (project view) and `src/app/(dashboard)/docs/` (global view). API routes are at `/api/docs/[projectKey]/...`.

**Rules enforced in code:**

1. **DocSpace is lazy-upserted** — there is no DocSpace creation endpoint. A `DocSpace` row is created automatically (via `upsert`) the first time a user visits `/projects/[key]/docs` or calls `GET /api/docs/[projectKey]`. Do not try to pre-create DocSpaces at project creation time.
2. **DocPageType** — two values: `NATIVE` (TipTap HTML stored in the `content` field — same format as issue descriptions/comments, not raw Markdown) and `DOCUMENT` (file upload; `fileKey`, `fileSize`, `mimeType` fields used instead). Do not add intermediate types without a product decision.
3. **`DocSpace.isPublic`** — reserved for the Phase 5 visibility toggle (makes a project's docs readable by all authenticated users). Do not repurpose this field.
4. **Page revisions** — `PageRevision` rows are snapshot-only (created on save, never mutated). The PATCH handler for `/api/docs/[projectKey]/pages/[pageId]` automatically snapshots the previous content into a new `PageRevision` whenever `content` is included in the update body — do not break this side-effect when modifying that handler. Restoring a revision means writing its content back to `DocPage.content` and creating a new revision from the current content first (the auto-snapshot in PATCH handles this).

---

## Reference docs (load when relevant)

- .context-docs/rich-text.md — TipTap packages, HTML storage, empty-state normalization
- .context-docs/notifications.md — trigger points, known gaps, UI entry points, server actions
- .context-docs/avatars.md — S3 upload, proxy route, session refresh
- .context-docs/shortcuts.md — global and project-context keyboard shortcuts
- .context-docs/roadmap-workflow.md — JFR project workflow for roadmap items
