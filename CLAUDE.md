# TaskForge / JedForge — Codebase Notes

## Session workflow

### Startup checklist (run at the beginning of every session)
1. `git status` — confirm the working tree is clean before starting. Commit or stash any pre-existing changes first.
2. `docker start taskforge-db 2>/dev/null; docker ps --filter name=taskforge-db --format "{{.Status}}"` — confirm Postgres is running.
3. Find or create a JedForge issue for the work ahead. The only open production projects are **JFR** (JedForge work) and **WEQUIZ** (both in "The OG" org) — TFEN and JFDOCS are closed; use JFR for new JedForge issues. See `CLAUDE_API.md` → Working Convention.

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

**There is no feature to move a project between organizations** — neither in the UI, admin actions, nor the v1 API. When a move is needed, do it via direct SQL in a single transaction: upsert `OrgMember` rows (MEMBER) in the target org for every `ProjectMember` of the moving project first, then update `Project.orgId` — otherwise invariants 2–5 break. `OrgMember.id` has no DB default (Prisma generates cuids); `gen_random_uuid()::text` works for manual inserts.

**Non-goals (do not implement without a separate product decision):**
Org switching UI, full invite system, billing changes, broad project membership role redesign, cascading project deletion on org delete.

---

## Closed project invariants

Projects have an `isClosed Boolean @default(false)` field. Rules enforced in code:

1. **Only `UserRole.ADMIN` can close or reopen a project** — `closeProject`/`reopenProject` actions in `src/app/(dashboard)/admin/actions.ts` call `requireAdmin()` before mutating.
2. **Active projects listing filters closed projects** — `src/app/(dashboard)/projects/page.tsx` adds `isClosed: false` to its Prisma query. Closed projects do not appear on the main Projects page for any user.
3. **Non-admins are redirected from closed project URLs** — `src/app/(dashboard)/projects/[projectKey]/layout.tsx` redirects to `/projects` if `project.isClosed && session.user.role !== "ADMIN"`. Admins can still navigate into closed projects.
4. **`/projects/closed` is visible to all authenticated users** — non-admins see only closed projects they are members of; admins see all closed projects.
5. **Re-Open button is disabled for non-admins** — the button renders with `disabled` attribute and reduced opacity. The server action (`src/app/(dashboard)/projects/closed-actions.ts`) also re-checks admin role server-side.
6. **`getAdminProjects` uses explicit `select`** — if you add fields to the `Project` model that the admin panel needs to display, add them to the `select` block in that function (`src/app/(dashboard)/admin/actions.ts`).
7. **Dashboard and global Docs page filter closed projects** — all four queries in `src/app/(dashboard)/page.tsx` (`getUserProjects`, `getAssignedIssues`, `getUpcomingDueDates`, `getRecentActivity`) add `isClosed: false`. The global Docs page (`src/app/(dashboard)/docs/page.tsx`) also filters `isClosed: false` from project memberships.
8. **There is no Archive concept** — the `isArchived` field and `archiveProject` action have been removed. Close (`isClosed`, admin-only) is the only project deactivation mechanism. Project settings Danger Zone contains only "Project Visibility" (admin-only toggle) and "Delete Project".

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

## Subagent file-write limitation in worktrees

When agents are launched with `isolation: "worktree"`, Edit and Write tool calls are denied for source files inside the worktree directory (`.claude/worktrees/agent-xxx/`). Worktree agents can read files and run bash commands but cannot write. **Workaround:** do all file editing in the main context after the subagent returns its findings/code, or avoid `isolation: "worktree"` when the agent needs to write files.

---

## Database migrations

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

**Before writing any route or server action that queries Prisma, verify every field referenced exists in the current `schema.prisma`.** If a field is absent, note it and either adapt the query or plan a migration before proceeding.

---

## Internal v1 REST API

An internal API for Claude Code to track work in JedForge. **Requires the `X-Internal-Api-Key` header on every request.**

- **Local:** `http://localhost:3000/api/v1`
- **Production:** `https://taskforge-production-099b.up.railway.app/api/v1`
- **Reference:** see `CLAUDE_API.md` for full route docs and working convention

**Authentication:** All v1 API requests must include the header `X-Internal-Api-Key: <value of V1_API_KEY env var>`. The key is set in Railway environment variables and in the local `.env` file. Never commit the actual key value to the repository.

Routes: `GET/POST /api/v1/issues`, `GET/PATCH/DELETE /api/v1/issues/[key]`, `GET/POST /api/v1/issues/[key]/comments`, `PATCH/DELETE /api/v1/issues/[key]/comments/[commentId]`, `GET /api/v1/projects`, `GET /api/v1/projects/[id]`

To update an issue after completing work, use `PATCH /api/v1/issues/[key]` with `statusId` (not `status`) to mark it done. To post a comment, use `POST /api/v1/issues/[key]/comments` with `body` and `authorId`. Use `cmo365psl000vdrd0p63lirlz` as `authorId` to post as Maximus (Claude Code account). See `CLAUDE_API.md` for the full comments API.

**Schema notes:** `IssueStatus` and `IssuePriority` are enums, not database tables. Priority values are `CRITICAL | HIGH | MEDIUM | LOW` (URGENT is accepted as an alias for CRITICAL). Statuses are synthesised from the enum in API responses.

**Position constraint:** `PATCH /api/v1/issues/[key]` with a `statusId` that differs from the current status automatically appends the issue to the end of the target column (`position = count of issues already in that column`). This is required to satisfy the DEFERRABLE unique constraint on `(projectId, status, position)` — omitting the position update causes a 500 when the existing position value collides with another issue already in the target column.

**Create an issue at the start of every non-trivial task.** See `CLAUDE_API.md` → Working Convention.

---

## Local dev environment

- Docker Postgres on port 5433 — start with `docker start taskforge-db` if not running (see startup checklist above)
- **Railway CLI is unusable in this environment** — every command (`whoami`, `status`, `variables`) produces no output and exits 1, even with `RAILWAY_API_TOKEN` set. Use the **Railway GraphQL API** instead: `POST https://backboard.railway.com/graphql/v2` with header `Authorization: Bearer $RAILWAY_API_TOKEN`. The token is exported in `~/.bashrc` (non-interactive shells may not source it — read it from the file directly). TaskForge production lives in project "striking-strength" (`7a369174-b77d-49c0-9ef0-f651541fe383`), environment `816d8546-3458-4855-9699-b77c855019b9`, services `taskforge` and `Postgres` (`a303a6b4-af40-457d-a017-08bfcf3647ff`).
- **Direct production DB access:** query the GraphQL `variables(projectId, environmentId, serviceId)` field for the Postgres service and use its `DATABASE_PUBLIC_URL` with local `psql`. Fetch it fresh each time; never write it to a file that survives the session or commit it.
- Production URL: `https://taskforge-production-099b.up.railway.app` — `jedforge.com` has no DNS records
- Seeded test users (all password `password123`): `admin@taskforge.dev` (Alice Chen, `UserRole.ADMIN` — use this account to test any admin-gated feature), `member@taskforge.dev`, `carol@taskforge.dev`, `dave@taskforge.dev`
- Seeded local projects (keys): `PL` (Product Launch), `MA` (Mobile App), `WR` (Website Redesign), `JFR` (JedForge Roadmap). Production has additional projects (`TFEN`, `JFDOCS`, `WEQUIZ`, etc.) that do not exist in local dev.
- Auth page logos: `public/logo-light.png` and `public/logo-dark.png` are both **1254×1254 square** images. They are displayed at `w-[200px] sm:w-[260px]` on the login page — do not increase this without checking total page height fits inside a 1080p viewport (logo + card + gaps must stay under ~940px).
- Playwright v1.59.1 is installed in `node_modules` only (not global). In CJS scripts: `require('/home/jamie/Projects/TaskForge/node_modules/playwright')`. Chromium must be downloaded once with `npx playwright install chromium`. `tmux` is not available — start the dev server in the background: `npm run dev > /tmp/nextdev.log 2>&1 &` then `sleep 8` before driving it.

---

## Docs module invariants

The Docs module lives under `src/app/(dashboard)/projects/[projectKey]/docs/` (project view) and `src/app/(dashboard)/docs/` (global view). API routes are at `/api/docs/[projectKey]/...`.

**Rules enforced in code:**

1. **DocSpace is lazy-upserted** — there is no DocSpace creation endpoint. A `DocSpace` row is upserted automatically on any member's call to the docs API. The shared helper `resolveDocCtx` in `src/app/api/docs/_helpers.ts` handles this; all docs route files import it. The docs Next.js layout (`src/app/(dashboard)/projects/[projectKey]/docs/layout.tsx`) also upserts the DocSpace directly to fetch sidebar data — both upsert paths are intentional. Do not try to pre-create DocSpaces at project creation time.
2. **DocPageType** — two values: `NATIVE` (TipTap HTML stored in the `content` field — same format as issue descriptions/comments, not raw Markdown) and `DOCUMENT` (file upload; `fileKey`, `fileSize`, `mimeType` fields used instead). Do not add intermediate types without a product decision.
3. **`DocSpace.isPublic`** — when true, any authenticated JedForge user can read that project's docs even without a `ProjectMember` row. Only `PROJECT_LEAD` can toggle this via `PATCH /api/docs/[projectKey]` with `{ isPublic: boolean }`. `resolveDocCtx` returns `role: null` for non-member public readers; write operations (POST/PATCH/DELETE) still require a member role.
4. **Docs role enforcement** — enforced in all API routes via `resolveDocCtx` + permission helpers from `src/lib/permissions.ts`:
   - Read (GET): any project member, or any authenticated user on a public docspace
   - Create / edit pages and sections, file upload: `canEditIssues` (TEAM_MEMBER or PROJECT_LEAD)
   - Delete pages and sections: `canManageProject` (PROJECT_LEAD only)
   - Visibility toggle (`PATCH /api/docs/[projectKey]`): PROJECT_LEAD only (checked inline, not via `resolveDocCtx`)
5. **Docs search** — `GET /api/docs/[projectKey]/search?q=<query>` searches `DocPage.title` (all types) and `DocPage.content` (NATIVE only) with case-insensitive `contains`. Returns up to 20 results with `id`, `title`, `type`, `sectionTitle`, and a `snippet`. Accessible to any user who can read the docspace.
6. **Page revisions** — `PageRevision` rows are snapshot-only (created on save, never mutated). The PATCH handler for `/api/docs/[projectKey]/pages/[pageId]` automatically snapshots the previous content into a new `PageRevision` whenever `content` is included in the update body — do not break this side-effect when modifying that handler. Restoring a revision means writing its content back to `DocPage.content` and creating a new revision from the current content first (the auto-snapshot in PATCH handles this). **Cap: 50 revisions per page** — oldest are pruned in the same transaction as each content save.
7. **Issue↔DocPage cross-links** — `IssueDocLink` is the junction table (cascade-deletes when either side is deleted). Both issue and page must belong to the same project — enforced in the `linkDocPage` server action. Manage links via `linkDocPage` / `unlinkDocPage` in `actions.ts`; read linked issues for a page via `GET /api/docs/[projectKey]/pages/[pageId]/links`.

8. **DOCUMENT page file lifecycle** — files are uploaded via `POST /api/docs/[projectKey]/pages/[pageId]/file` (multipart `file` field; PDF and DOCX only, 50 MB max). That endpoint also sets `type = DOCUMENT` on the page, so posting a file to an existing NATIVE page converts it. `GET` on the same route returns `{ url, mimeType, fileName }` with a 1-hour presigned S3 URL. Files are stored at `docs/[docSpaceId]/[pageId]/[uuid]-[sanitized-filename]` in S3. The DELETE handler for a page removes the S3 object automatically; replacing a file via POST also deletes the previous object. PDFs render inline via `<iframe>`; DOCX files get a download-only prompt (no browser-native Word viewer). The UI creates the page stub first then uploads — a failed upload leaves an orphaned DOCUMENT page with no file (known edge case).

---

## Functional specification

The functional spec lives at `.context-docs/JedForge-FunctionalSpec-v2.0.docx`. Regenerate it with:
```bash
node scripts/generate-spec-v2.mjs
```

Then commit both `.context-docs/JedForge-FunctionalSpec-v2.0.docx` and `scripts/generate-spec-v2.mjs` if the script was also changed.

**Tooling notes for working with .docx files:**
- `extract-text` command does not exist on this machine. Use `python3` + `python-docx` to read .docx content.
- `python-docx` is not installed by default: `pip3 install python-docx --break-system-packages`
- `docx` npm package is installed globally at `/home/jamie/.npm-global/lib/node_modules/docx`. Import via `dist/index.mjs` (not `dist/index.js`). `NumberingConfig` is not exported — pass the numbering config object directly to `Document`.
- In the `docx` package, font `size` is in half-points: 10pt = `size: 20`, not `size: 200`. Use `n * 2`.
- `scripts/office/` directory and `validate.py` do not exist in this repo.

---

## Data integrity invariants (A2 audit)

- **Issue key generation is atomic** — `createIssue` in `actions.ts` uses `SELECT ... FOR UPDATE` on the Project row inside a Prisma transaction to serialise concurrent inserts. The `generateIssueKeyWithRetry` retry loop has been replaced; `src/lib/issue-keys.ts` is now unused by the main flow.
- **Kanban position writes are transactional** — `moveIssue` runs a single `prisma.$transaction` that locks the project row, reindexes both affected columns, and updates the issue status atomically. `reorderIssues` is also wrapped in a transaction. Position write failures throw an error (client retries).
- **S3 orphan cleanup on delete** — `DELETE /api/issues/[issueId]` fetches all attachments and deletes their S3 objects before cascading the DB delete. `DELETE /api/docs/[projectKey]/sections/[sectionId]` does the same for DOCUMENT-type pages. `deleteProject` (`src/app/(dashboard)/projects/[projectKey]/actions.ts`) also fetches and deletes all attachment and DOCUMENT-page S3 objects before the Prisma delete.
- **PageRevision cap = 50** — see Docs module invariant #6.
- **Notification cap = 100** — `src/lib/notifications.ts` prunes the oldest notifications beyond 100 after every insert. See `.context-docs/notifications.md`.
- **ActivityLog.userId is nullable** — `SET NULL` on user delete preserves audit history. `issueId` still cascades on issue delete.
- **SavedFilter requires projectId** — filters are project-scoped to prevent cross-tenant data leaks. `getMyFilters(projectId)` and `saveFilter(..., projectId)` require a projectId. The global `/search` page cannot save/load filters; use the project-specific search panel for that.

---

## Security constraints

- **v1 API requires shared secret** — every request to `/api/v1/...` must include `X-Internal-Api-Key: <V1_API_KEY>`. The guard is in `src/lib/v1-auth.ts` (constant-time comparison). Set `V1_API_KEY` in Railway environment variables and in local `.env`. Never commit the actual value.
- **Avatar GET requires authentication** — `GET /api/avatar` returns 401 without a valid session. The PUT handler was already protected; the GET was added in the same security pass.
- **TipTap HTML is sanitized server-side** — all write paths that persist issue descriptions, comment bodies, and doc page content call `sanitizeTipTapHtml()` from `src/lib/sanitize-html.ts` (backed by `isomorphic-dompurify`) before the Prisma call. The viewer component (`rich-text-display.tsx`) does not sanitize — it relies on content already being clean in the database.

---

## Reference docs (load when relevant)

- .context-docs/rich-text.md — TipTap packages, HTML storage, empty-state normalization
- .context-docs/notifications.md — trigger points, known gaps, UI entry points, server actions
- .context-docs/avatars.md — S3 upload, proxy route, session refresh
- .context-docs/shortcuts.md — global and project-context keyboard shortcuts
- .context-docs/roadmap-workflow.md — JFR project workflow for roadmap items
