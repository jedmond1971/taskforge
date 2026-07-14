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

**If `tsc --noEmit` fails with "Cannot find module" for a route you just deleted** — Next.js leaves stale type stubs under `.next/types/app/api/<path>/`. Delete the matching directory (`rm -rf .next/types/app/api/<path>`) and re-run.

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

**`ProjectMember` has no timestamp columns** — the table schema is `(id, "userId", "projectId", role)` only. Direct psql inserts must omit `createdAt`/`updatedAt`: `INSERT INTO "ProjectMember" (id, "userId", "projectId", role) VALUES (gen_random_uuid()::text, ..., 'TEAM_MEMBER') ON CONFLICT DO NOTHING`.

**Non-goals (do not implement without a separate product decision):**
Org switching UI, billing changes, broad project membership role redesign, cascading project deletion on org delete.

---

## Closed project invariants

Projects have an `isClosed Boolean @default(false)` field. Rules enforced in code:

1. **Only `UserRole.ADMIN` can close or reopen a project** — `closeProject`/`reopenProject` actions in `src/app/(dashboard)/admin/actions.ts` call `requireAdmin()` before mutating.
2. **Active projects listing filters closed projects** — `src/app/(dashboard)/projects/page.tsx` adds `isClosed: false` to its Prisma query. Closed projects do not appear on the main Projects page for any user.
3. **Non-admins are redirected from most closed project URLs** — `src/app/(dashboard)/projects/[projectKey]/layout.tsx` redirects to `/projects` if the project is closed and the user is not an admin, **unless** the path matches `/projects/[key]/docs` (including sub-pages). Docs are intentionally accessible on closed projects. The layout reads the current path via `headers().get('x-pathname')`, which the middleware sets on every request. Admins can navigate anywhere in a closed project.
4. **`/projects/closed` is visible to all authenticated users** — non-admins see only closed projects they are members of; admins see all closed projects.
5. **Re-Open button is disabled for non-admins** — the button renders with `disabled` attribute and reduced opacity. The server action (`src/app/(dashboard)/projects/closed-actions.ts`) also re-checks admin role server-side.
6. **`getAdminProjects` uses explicit `select`** — if you add fields to the `Project` model that the admin panel needs to display, add them to the `select` block in that function (`src/app/(dashboard)/admin/actions.ts`).
7. **Dashboard filters closed projects; global Docs page does not** — all four queries in `src/app/(dashboard)/page.tsx` (`getUserProjects`, `getAssignedIssues`, `getUpcomingDueDates`, `getRecentActivity`) add `isClosed: false`. The global Docs page (`src/app/(dashboard)/docs/page.tsx`) shows all member projects — open ones at the top, closed ones in a separate "Closed Projects" section with a lock badge and read-only subtitle.
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

## Email sending (Resend + React Email)

Email templates live in `src/emails/`. The send helper is `sendOrgInviteEmail()` in `src/lib/invites.ts`.

**Resend client must be instantiated lazily** — `new Resend(process.env.RESEND_API_KEY)` at module level throws during Next.js static page data collection in CI (where the env var is absent), crashing the build. Always instantiate inside the function that uses it, not at module top level.

**`react:` option in `resend.emails.send()` fails at runtime** ("render is not a function") even though TypeScript accepts it. Always render manually first and pass the result as `html:`:
```ts
import { render } from "@react-email/components";
const html = await render(MyEmail({ ...props }));
await resend.emails.send({ ..., html });
```

Sending domain `jedforge.com` is verified with Resend. From address: `invites@jedforge.com` (the specific mailbox does not need to exist).

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

**`Board` and `Column` models are dead code** — both exist in `schema.prisma` but `prisma.board` and `prisma.column` are never called anywhere in `src/`. The Kanban view is driven entirely by `ProjectStatus` rows. Do not use these models; they can be dropped from the schema when convenient.

---

## Internal v1 REST API

Internal API for Claude Code to track work. Full docs in `CLAUDE_API.md`. **Create an issue at the start of every non-trivial task.**

- **Local:** `http://localhost:3000/api/v1` | **Production:** `https://taskforge-production-099b.up.railway.app/api/v1`
- **Always use the production URL for issue tracking** — creating issues and posting comments must go to production. Local dev issues are ephemeral and invisible in the real tracker. Use local only when testing the API itself.
- Auth: `X-Internal-Api-Key: <V1_API_KEY>` on every request. Never commit the key.
- Post comments as Maximus: `authorId: "cmo365psl000vdrd0p63lirlz"` — **production only**. Maximus does not exist in the local dev DB. For local v1 API calls that require an authorId, use Alice Chen (`cmo37pswr00007vd13y3cgzqz`).
- **`GET /api/v1/projects` returns `{ projects: [...] }`, not a plain array** — access the list as `data['projects']`, not `data` directly.
- `statusId` accepts a cuid, a human name (`"Done"`), or a category key (`"DONE"`) — all three forms work.
- `IssueStatus` enum is gone — use `ProjectStatus` rows. `IssuePriority`: `CRITICAL | HIGH | MEDIUM | LOW`.
- **Use Python `urllib` for API calls whose JSON body contains backticks** — bash interprets backticks in curl `-d` strings as command substitution, causing the call to fail silently with a 500. `python3 -c "..."` double-quoted strings have the **same problem** — bash still expands backticks inside `"`. Use `python3 -c '...'` (single-quoted outer string, no literal single quotes in data) or a heredoc Python script (`python3 << 'PYEOF' ... PYEOF`) instead.
- **Issue creation is `POST /api/v1/issues` with `projectId` in the body** — there is no `/api/v1/projects/[key]/issues` route; using it returns 404. `projectId` must be the cuid, not the project key. Get the cuid from `GET /api/v1/projects` if you only know the key.
- **`GET` and `PATCH /api/v1/issues/[id]` accept the issue key** (e.g. `JFR-88`) as well as the cuid. Using a cuid for PATCH returns 404 — always use the key form (e.g. `JFR-88`) for single-issue operations.

---

## Local dev environment (Windows / Jed's machine)

- **Local `.env` exists** — `/home/jamie/Projects/TaskForge/.env` is present and contains `V1_API_KEY`, `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`. If it ever goes missing, recreate from `.env.example` and re-add secrets from Railway.
- **V1_API_KEY ends in `=` — use `cut -d= -f2-` to extract it** — the key is a base64 string (e.g., `...h9E1mESb0tU=`). `grep V1_API_KEY .env | cut -d= -f2` silently drops the trailing `=`, causing "Unauthorized" on every API call. Always use `cut -d= -f2-` (field 2 to end-of-line) or hardcode the value in Python scripts.
- **PowerShell git commit heredocs** — the bash `$(cat <<'EOF'…EOF)` pattern fails in PowerShell. Use the PowerShell here-string syntax instead: `git commit -m @'` … `'@` (closing `'@` must be at column 0).
- Docker Postgres on port 5433 — start with `docker start taskforge-db` if not running (see startup checklist above)
- **Railway CLI is unusable in this environment** — every command (`whoami`, `status`, `variables`) produces no output and exits 1, even with `RAILWAY_API_TOKEN` set. Use the **Railway GraphQL API** instead: `POST https://backboard.railway.com/graphql/v2` with header `Authorization: Bearer $RAILWAY_API_TOKEN`. The token is exported in `~/.bashrc` (non-interactive shells may not source it — read it from the file directly). TaskForge production lives in project "striking-strength" (`7a369174-b77d-49c0-9ef0-f651541fe383`), environment `816d8546-3458-4855-9699-b77c855019b9`, service `taskforge` (`63950f57-c892-45d6-8c9e-937e75517994`), service `Postgres` (`a303a6b4-af40-457d-a017-08bfcf3647ff`).
- **Restarting a crashed Railway service:** use the `serviceInstanceRedeploy` mutation — `mutation { serviceInstanceRedeploy(environmentId: "...", serviceId: "...") }`.
- **Direct production DB access:** query the GraphQL `variables(projectId, environmentId, serviceId)` field for the Postgres service and use its `DATABASE_PUBLIC_URL` with local `psql`. Fetch it fresh each time; never write it to a file that survives the session or commit it. The `variables` field returns a **flat key/value object** (not edges/nodes) — query it as `{ variables(projectId: "...", environmentId: "...", serviceId: "...") }` with no subfields and access results as `d['data']['variables']['KEY_NAME']`. Queries with `{ edges { node { name value } } }` subfields fail with a schema validation error.
- Production URL: `https://www.jedforge.com` (also accessible at `https://taskforge-production-099b.up.railway.app`)
- Seeded test users (all password `password123`): `admin@taskforge.dev` (Alice Chen, `UserRole.ADMIN` — use this account to test any admin-gated feature), `member@taskforge.dev`, `carol@taskforge.dev`, `dave@taskforge.dev`
- Seeded local projects (keys): `PL` (Product Launch), `MA` (Mobile App), `WR` (Website Redesign), `JFR` (JedForge Roadmap). Production has additional projects (`TFEN`, `JFDOCS`, `WEQUIZ`, etc.) that do not exist in local dev.
- Auth page logos: `public/logo-light.png` and `public/logo-dark.png` are both **1254×1254 square** images. They are displayed at `w-[200px] sm:w-[260px]` on the login page — do not increase this without checking total page height fits inside a 1080p viewport (logo + card + gaps must stay under ~940px).
- Playwright v1.59.1 is installed in `node_modules` only (not global). In CJS scripts: `require('/home/jamie/Projects/TaskForge/node_modules/playwright')`. **`npx playwright install chromium` requires sudo and will fail** — instead use `executablePath: '/usr/bin/google-chrome'` in `chromium.launch()`. `tmux` is not available — start the dev server in the background: `npm run dev > /tmp/nextdev.log 2>&1 &` then `sleep 8` before driving it. **Port 3000 may already be in use** (e.g. a leftover dev server from a prior session) — Next.js will silently fall back to 3001 or higher. Always resolve the actual port before writing Playwright URLs: `grep "Local:" /tmp/nextdev.log | head -1`.
- **Playwright + Next.js App Router client-side navigation** — after clicking a link that triggers client-side routing, `page.url()` and `waitForLoadState('networkidle')` are unreliable. Use `page.goto('http://localhost:3000/projects/PL/issues/PL-1')` directly instead of clicking through from a list page.
- **Playwright `waitForURL` with glob patterns** — `page.waitForURL('http://localhost:3000/**')` resolves immediately if the page is already at a matching URL (e.g., you're already on `/login`). When waiting for login to complete, use a predicate instead: `page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 })`.
- **Playwright `page.$('text=...')` with special characters** — the middle-dot `·` and similar Unicode characters can silently fail to match. Use `(await page.content()).includes('...')` for reliable substring checks.

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

## Middleware and server component patterns

- **Reading the current path in a server component layout** — Next.js layouts receive `params` but not the full URL path. The middleware (`src/middleware.ts`) sets `x-pathname` on every request via `new Headers(req.headers); requestHeaders.set('x-pathname', nextUrl.pathname)` passed to `NextResponse.next({ request: { headers: requestHeaders } })`. Server components can then read it with `import { headers } from 'next/headers'; headers().get('x-pathname')`. This is how the project layout distinguishes docs paths from other paths for closed-project access control.

- **Dynamic breadcrumb titles — `PageTitleContext`** — `Header.tsx` builds breadcrumbs from URL segments using `segmentLabel()`, which cannot resolve database values (e.g. a doc page cuid becomes a garbled crumb). The fix is `src/components/layout/PageTitleContext.tsx`: render `<SetPageTitle title={someTitle} />` (a null-rendering client component) from any server page component, and `Header` will replace the last breadcrumb label with that title. The context resets to `null` on every pathname change, so stale titles never bleed across navigation. `DashboardShell` wraps the whole layout in `PageTitleProvider` — no additional provider setup is needed. Use this pattern on any page whose last URL segment is a cuid or other opaque ID.

- **Middleware invite-route exemption** — `/invite/[token]` routes must be accessible regardless of auth state (unauthenticated users can create accounts via them; logged-in users need to reach them too). In `src/middleware.ts`, add `const isInviteRoute = nextUrl.pathname.startsWith("/invite/")` and return `NextResponse.next()` immediately after the `isAuthRoute` block, before the `if (!isLoggedIn)` redirect. Unlike `/login` and `/register`, invite routes do NOT redirect logged-in users away.

- **JWT callback `orgId` refresh on `session.update()`** — The jwt callback only sets `token.orgId` when the `user` param is present (i.e., initial sign-in). If an existing logged-in user joins a new org and you call `update({})` to refresh the session, the old `orgId` will remain unless the `trigger === "update"` branch also re-queries `prisma.orgMember.findFirst`. The fix (in `src/lib/auth.ts`): inside the `trigger === "update"` block, always re-fetch the membership and update `token.orgId`. This is what lets the existing-user invite accept path pick up the new org without a logout/login cycle.

---

## Server action pitfalls

- **`e.repeat` guard on keyboard handlers** — any `onKeyDown` handler that calls a server action (or any expensive async operation) must check `!e.repeat`. Browsers fire repeated `keydown` events while a key is held, and React's async state updates won't have reflected `isLoading: true` before the repeats fire. Missing this caused the JFR-79 crash: each repeat triggered `runQuery` which runs two parallel Prisma queries, exhausting Railway's connection pool before the first response returned.

- **Next.js redacts thrown Error messages from Server Actions in production** — in `next start` mode, any `throw new Error("my message")` inside a Server Action is replaced with a generic digest string on the client ("An error occurred..."). This only happens in production; local `next dev` shows the real message. For expected validation/guard failures that must show a specific message to the user, **return a discriminated union instead of throwing**: `return { success: false, error: "my message" }`. The client checks `if (!result.success) toast.error(result.error)`. Genuine unexpected errors (DB down, programming bugs) can still throw — those are supposed to hit the generic error boundary. The admin panel (`src/app/(dashboard)/admin/actions.ts`) uses `ActionResult` / `InviteResult` types for this pattern.

---

## Testing

- **`src/__tests__/tenancy.test.ts` has a hand-written Prisma mock** — the `mockPrisma` object in the `vi.hoisted()` block lists every Prisma model and method explicitly. When you add a new model that's called from any admin action (or any code covered by that test file), you must add it to the mock or tests fail with `TypeError: Cannot read properties of undefined (reading 'create')`. Add the model with whatever methods it uses, e.g. `adminAuditLog: { create: vi.fn().mockResolvedValue({}) }`. The other test files (`permissions.test.ts`, `docs.test.ts`, etc.) have their own separate mocks — check each one if your new code is exercised by multiple test files.
- **`tenancy.test.ts` also tests admin action *behaviors*, not just the mock structure** — some tests use `.rejects.toThrow(...)` to assert that admin actions throw on invalid input. If you change an action from throwing to returning `{ success: false, error }` (per the Server Action pattern above), those assertions break. Update them to `const result = await action(...); expect(result).toEqual({ success: false, error: expect.stringContaining("...") })`.

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
- **Comment edit/delete requires current membership** — `updateComment` and `deleteComment` in `src/app/(dashboard)/projects/[projectKey]/actions.ts` call `requireProjectMember(projectKey)` before the author check. A cross-project guard (`comment.issue.projectId !== projectId`) also returns "Comment not found" if the comment belongs to a different project than the key in the URL.
- **Attachment delete requires current membership** — `DELETE /api/attachments/[id]/route.ts` gates both the uploader and `PROJECT_LEAD` paths on `!!member`, so a former member cannot delete their own uploaded files.
- **Session invalidation via `sessionVersion`** — `User.sessionVersion` (Int, default 1) is a monotonically increasing counter. The jwt callback in `src/lib/auth.ts` fetches the current DB value on every `auth()` call and sets `token.invalidated = true` if the versions differ. `getCurrentUser()` returns `null` for invalidated tokens, so all `requireAuth`/`requireAdmin`/page-layout guards see the user as logged out on their next request. Three events bump the counter: `adminResetUserPassword`, `adminUpdateUser` (role changes only), and `changePassword`. After a self-service password change, the client calls `session.update()` which triggers `trigger === "update"` in the jwt callback — this re-arms the active session's token by syncing its version forward, keeping the password-changing browser logged in while all other sessions are invalidated. **Deliberate limitation:** invalidation is NOT enforced at the Edge middleware layer (`src/lib/auth.config.ts`) because Prisma cannot run in Edge runtimes. An invalidated session will still pass the middleware's auth check but will be caught by `getCurrentUser()` on the first server-component or server-action call.

---

## Reference docs (load when relevant)

- .context-docs/docs-invariants.md — all 8 Docs module rules (DocSpace, roles, revisions, file lifecycle)
- .context-docs/data-integrity.md — A2 audit invariants (key gen, kanban positions, S3 cleanup, caps)
- .context-docs/rich-text.md — TipTap packages, HTML storage, empty-state normalization
- .context-docs/notifications.md — trigger points, known gaps, UI entry points, server actions
- .context-docs/avatars.md — S3 upload, proxy route, session refresh
- .context-docs/shortcuts.md — global and project-context keyboard shortcuts
- .context-docs/roadmap-workflow.md — JFR project workflow for roadmap items
