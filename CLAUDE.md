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

**`lucide-react` icon naming gotcha** — `LinkOff` does not exist in the installed version (1.7.0). The correct name is `Link2Off`. When in doubt, check exports with `node -e "const l = require('lucide-react'); console.log(Object.keys(l).filter(k => /link/i.test(k)))"`.

---

## Adding npm packages

Claude Code cannot run `npm install` directly. To add packages:
1. Edit `package.json` manually.
2. Ask Jamie to run `npm install` locally to update `package-lock.json`.
3. Commit both files and push. Railway uses `npm ci` which requires the lockfile to be in sync.

## Subagent file-write limitation in worktrees

Worktree agents (`isolation: "worktree"`) can read and run bash but cannot Edit/Write source files. Do all file editing in the main context after the subagent returns its findings.

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

Internal API for Claude Code to track work. Full docs in `CLAUDE_API.md`. **Create an issue at the start of every non-trivial task.**

- **Local:** `http://localhost:3000/api/v1` | **Production:** `https://taskforge-production-099b.up.railway.app/api/v1`
- Auth: `X-Internal-Api-Key: <V1_API_KEY>` on every request. Never commit the key.
- Post comments as Maximus: `authorId: "cmo365psl000vdrd0p63lirlz"`
- `statusId` accepts a cuid, a human name (`"Done"`), or a category key (`"DONE"`) — all three forms work.
- `IssueStatus` enum is gone — use `ProjectStatus` rows. `IssuePriority`: `CRITICAL | HIGH | MEDIUM | LOW`.
- **Use Python `urllib` for API calls whose JSON body contains backticks** — bash interprets backticks in curl `-d` strings as command substitution, causing the call to fail silently with a 500. Use `python3 -c` or a heredoc Python script with `urllib.request` instead.

---

## Local dev environment (Windows / Jed's machine)

- **Local `.env` exists** — `/home/jamie/Projects/TaskForge/.env` is present and contains `V1_API_KEY`, `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`. If it ever goes missing, recreate from `.env.example` and re-add secrets from Railway.
- **PowerShell git commit heredocs** — the bash `$(cat <<'EOF'…EOF)` pattern fails in PowerShell. Use the PowerShell here-string syntax instead: `git commit -m @'` … `'@` (closing `'@` must be at column 0).
- Docker Postgres on port 5433 — start with `docker start taskforge-db` if not running (see startup checklist above)
- **Railway CLI is unusable in this environment** — every command (`whoami`, `status`, `variables`) produces no output and exits 1, even with `RAILWAY_API_TOKEN` set. Use the **Railway GraphQL API** instead: `POST https://backboard.railway.com/graphql/v2` with header `Authorization: Bearer $RAILWAY_API_TOKEN`. The token is exported in `~/.bashrc` (non-interactive shells may not source it — read it from the file directly). TaskForge production lives in project "striking-strength" (`7a369174-b77d-49c0-9ef0-f651541fe383`), environment `816d8546-3458-4855-9699-b77c855019b9`, service `taskforge` (`63950f57-c892-45d6-8c9e-937e75517994`), service `Postgres` (`a303a6b4-af40-457d-a017-08bfcf3647ff`).
- **Restarting a crashed Railway service:** use the `serviceInstanceRedeploy` mutation — `mutation { serviceInstanceRedeploy(environmentId: "...", serviceId: "...") }`.
- **Direct production DB access:** query the GraphQL `variables(projectId, environmentId, serviceId)` field for the Postgres service and use its `DATABASE_PUBLIC_URL` with local `psql`. Fetch it fresh each time; never write it to a file that survives the session or commit it.
- Production URL: `https://www.jedforge.com` (also accessible at `https://taskforge-production-099b.up.railway.app`)
- Seeded test users (all password `password123`): `admin@taskforge.dev` (Alice Chen, `UserRole.ADMIN` — use this account to test any admin-gated feature), `member@taskforge.dev`, `carol@taskforge.dev`, `dave@taskforge.dev`
- Seeded local projects (keys): `PL` (Product Launch), `MA` (Mobile App), `WR` (Website Redesign), `JFR` (JedForge Roadmap). Production has additional projects (`TFEN`, `JFDOCS`, `WEQUIZ`, etc.) that do not exist in local dev.
- Auth page logos: `public/logo-light.png` and `public/logo-dark.png` are both **1254×1254 square** images. They are displayed at `w-[200px] sm:w-[260px]` on the login page — do not increase this without checking total page height fits inside a 1080p viewport (logo + card + gaps must stay under ~940px).
- Playwright v1.59.1 is installed in `node_modules` only (not global). In CJS scripts: `require('/home/jamie/Projects/TaskForge/node_modules/playwright')`. **`npx playwright install chromium` requires sudo and will fail** — instead use `executablePath: '/usr/bin/google-chrome'` in `chromium.launch()`. `tmux` is not available — start the dev server in the background: `npm run dev > /tmp/nextdev.log 2>&1 &` then `sleep 8` before driving it.
- **Playwright + Next.js App Router client-side navigation** — after clicking a link that triggers client-side routing, `page.url()` and `waitForLoadState('networkidle')` are unreliable. Use `page.goto('http://localhost:3000/projects/PL/issues/PL-1')` directly instead of clicking through from a list page.

---

## Docs module invariants

See `.context-docs/docs-invariants.md` for all 8 rules. Key facts:

- DocSpaces are lazy-upserted via `resolveDocCtx` (`src/app/api/docs/_helpers.ts`) — do not pre-create them.
- `DocPageType`: `NATIVE` (TipTap HTML) or `DOCUMENT` (file upload). No other types.
- Role enforcement: read = any member (or any authed user if `isPublic`); edit = `TEAM_MEMBER+`; delete = `PROJECT_LEAD`.
- Page revisions auto-snapshot on every content save; cap = 50.

---

## Functional specification

Spec: `.context-docs/JedForge-FunctionalSpec-v2.0.docx` — regenerate with `node scripts/generate-spec-v2.mjs`, then commit both files.

**Tooling notes for .docx:**
- Read with `python3` + `python-docx` (`pip3 install python-docx --break-system-packages`). `extract-text` does not exist.
- `docx` npm package: `/home/jamie/.npm-global/lib/node_modules/docx`, import via `dist/index.mjs`. Font `size` is half-points: 10pt = `size: 20`.

---

## Server action pitfalls

- **`e.repeat` guard on keyboard handlers** — any `onKeyDown` handler that calls a server action (or any expensive async operation) must check `!e.repeat`. Browsers fire repeated `keydown` events while a key is held, and React's async state updates won't have reflected `isLoading: true` before the repeats fire. Missing this caused the JFR-79 crash: each repeat triggered `runQuery` which runs two parallel Prisma queries, exhausting Railway's connection pool before the first response returned.

---

## Data integrity invariants

See `.context-docs/data-integrity.md` for full details. Key facts:

- Issue key generation and kanban position writes are wrapped in `prisma.$transaction` with row-level locks.
- S3 objects are cleaned up on delete (issues, doc sections, project delete).
- Notification cap = 100; PageRevision cap = 50.
- `SavedFilter` requires `projectId` — global `/search` page cannot save/load filters.

---

## Security constraints

- **v1 API requires shared secret** — every request to `/api/v1/...` must include `X-Internal-Api-Key: <V1_API_KEY>`. The guard is in `src/lib/v1-auth.ts` (constant-time comparison). Set `V1_API_KEY` in Railway environment variables and in local `.env`. Never commit the actual value.
- **Avatar GET requires authentication** — `GET /api/avatar` returns 401 without a valid session. The PUT handler was already protected; the GET was added in the same security pass.
- **TipTap HTML is sanitized server-side** — all write paths that persist issue descriptions, comment bodies, and doc page content call `sanitizeTipTapHtml()` from `src/lib/sanitize-html.ts` (backed by `isomorphic-dompurify`) before the Prisma call. The viewer component (`rich-text-display.tsx`) does not sanitize — it relies on content already being clean in the database.

---

## Reference docs (load when relevant)

- .context-docs/docs-invariants.md — all 8 Docs module rules (DocSpace, roles, revisions, file lifecycle)
- .context-docs/data-integrity.md — A2 audit invariants (key gen, kanban positions, S3 cleanup, caps)
- .context-docs/rich-text.md — TipTap packages, HTML storage, empty-state normalization
- .context-docs/notifications.md — trigger points, known gaps, UI entry points, server actions
- .context-docs/avatars.md — S3 upload, proxy route, session refresh
- .context-docs/shortcuts.md — global and project-context keyboard shortcuts
- .context-docs/roadmap-workflow.md — JFR project workflow for roadmap items
