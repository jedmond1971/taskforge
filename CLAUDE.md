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

**`[...new Set()]` spread fails TypeScript (TS2802)** — The project's TypeScript target does not support iterating Sets via spread. Use `Array.from(new Set(...))` instead.

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

**`CustomFieldValue` has `updatedAt` but no `createdAt`** — the model uses `@updatedAt` (auto-managed by Prisma) but has no `createdAt` field. Direct psql inserts must include `"updatedAt"` explicitly (use `now()`); omitting it causes a not-null violation.

**`ApiKey.createdById` uses `ON DELETE RESTRICT`** — you cannot delete a `User` who has created API keys; the FK violation will abort the delete. Any future admin user-deletion action must revoke (set `revokedAt`) or reassign all `ApiKey` rows for that user first.

**Non-goals (do not implement without a separate product decision):**
Org switching UI, billing changes, broad project membership role redesign, cascading project deletion on org delete.

---

## Closed project invariants

See `.context-docs/closed-projects.md` for all 8 rules. Key facts:

- `isClosed` (admin-only close/reopen) is the only project deactivation mechanism — there is no Archive concept.
- Active Projects page, Dashboard, and closed-project URLs (except `/projects/[key]/docs`) filter or redirect on `isClosed`.
- `/projects/closed` is visible to everyone; non-admins see only projects they're a member of.

---

## UI component library

This project uses **`@base-ui/react`** (NOT Radix UI). Standard shadcn components that depend on Radix do not exist here. Custom equivalents are built on Base UI primitives.

- `src/components/ui/confirm-dialog.tsx` — use for all destructive action confirmations (not `window.confirm()`)
- `src/components/ui/rich-text-editor.tsx` — TipTap v2 editor
- `src/components/ui/rich-text-display.tsx` — read-only HTML renderer for TipTap content

See `.context-docs/rich-text.md` for TipTap packages, storage format, and empty-state behavior.

**No `Tooltip` component exists** — `src/components/ui/` has nothing for hover tooltips (checked while building the collapsible sidebar, JFR-101). For icon-only UI, use plain `title`/`aria-label` attributes rather than assuming a themed tooltip is available; building a Base UI Tooltip primitive is a separate, larger piece of scope.

**No `Select` component exists either** — enum/dropdown pickers (issue priority, type, status, etc.) all use a plain native `<select>` with a shared Tailwind class string (see `selectClass` / `InlineSelect` in `src/components/issues/IssueDetail.tsx`), not a Base UI Select wrapper. `@base-ui/react` is only used in this codebase for `input`, `button`, `separator`, `menu` (dropdown-menu.tsx, an action list — not a form select), `avatar`, and `dialog`. Match the native-`<select>` pattern for new enum pickers rather than building a Base UI Select wrapper (confirmed while building the board auto-hide-duration picker, JFR-117).

**`lucide-react` icon naming gotcha** — `LinkOff` does not exist in the installed version (1.7.0). The correct name is `Link2Off`. When in doubt, check exports with `node -e "const l = require('lucide-react'); console.log(Object.keys(l).filter(k => /link/i.test(k)))"`.

**No `next/image` usage anywhere in this codebase** — every image (auth page logos, sidebar wordmark/glyph, mobile top bar logo) is a plain `<img>` tag, which is why `npm run lint` already reports several pre-existing `@next/next/no-img-element` warnings. Adding more plain `<img>` tags for logo/icon-style assets, consistent with this existing pattern, will add further warnings of the same type — that's expected and not a "new warning" regression in the sense the pre-commit checklist means to guard against. It would be a real inconsistency to introduce `next/image` in only one spot.

**Chaining a `dark:` variant with a responsive variant on one element (e.g. `lg:dark:block`) has unverified/ambiguous win-order against a sibling `dark:hidden` class in this project's Tailwind v4 setup** — avoid it. Prefer nesting: wrap theme-scoped content in an outer `dark:hidden` / `hidden dark:block` container first, then apply only the single remaining variant (e.g. `lg:block`) to elements inside it. Used for the collapsed-sidebar wordmark→glyph swap in `Sidebar.tsx`.

**Desktop-only, localStorage-persisted UI preferences must hide content via breakpoint-scoped CSS, not JS unmounting** — e.g. `collapsed && "lg:hidden"`, never `{!collapsed && ...}`. A stale `true` value restored from `localStorage` on a mobile device would otherwise unmount content that the mobile layout still needs, since the desktop preference has no business affecting a breakpoint it was never set at. Established with the sidebar collapse feature (`Sidebar.tsx` / `DashboardShell.tsx`, JFR-101) — apply the same rule to any future desktop-only persisted toggle.

---

## Adding npm packages

`npm install` runs fine in Claude Code's shell in this environment (verified 2026-07-31) — the earlier note that it couldn't be run directly was wrong. To add a package: edit `package.json`, then run `npm install` yourself to update `package-lock.json`, then commit both in the same change. **Do not skip the lockfile update** — CI and Railway both use `npm ci`, which fails with `EUSAGE` if `package.json` and `package-lock.json` are out of sync (this broke a push during the AI Chat work).

## Email sending (Resend + React Email)

Email templates live in `src/emails/`, send helper `sendOrgInviteEmail()` in `src/lib/invites.ts`. See `.context-docs/email.md` for the Resend lazy-instantiation and `render()`-before-send gotchas.

## Subagent file-write limitation in worktrees

Worktree agents (`isolation: "worktree"`) can read and run bash but cannot Edit/Write source files. Do all file editing in the main context after the subagent returns its findings.

**A worktree created under `.claude/worktrees/` (nested inside the repo) breaks `next lint` and `npm test` while it exists** — see `.context-docs/local-dev-tooling.md` → "Nested worktree tooling conflicts" for the lint workaround and why `npm test` from the main checkout double-runs (and flakes) every test file until the worktree is removed. Always remove/exit the worktree before trusting a "final" `npm test` run on the main checkout.

---

## Database migrations

For local dev (Docker Postgres on port 5433): `npx prisma migrate dev`. Always update `prisma/schema.prisma` first and run `npx prisma generate` after schema changes. Production migrations auto-apply on every Railway deploy (`preDeployCommand` in `railway.toml`) — no manual step needed.

**Before writing any route or server action that queries Prisma, verify every field referenced exists in the current `schema.prisma`.** If a field is absent, note it and either adapt the query or plan a migration before proceeding.

See `.context-docs/migrations.md` for the non-interactive-TTY workaround and the `Board`/`Column` dead-code note.

---

## Internal v1 REST API

Internal API for Claude Code to track work. Full docs in `CLAUDE_API.md`. **Create an issue at the start of every non-trivial task.**

- **Local:** `http://localhost:3000/api/v1` | **Production:** `https://taskforge-production-099b.up.railway.app/api/v1`
- **Always use the production URL for issue tracking** — creating issues and posting comments must go to production. Local dev issues are ephemeral and invisible in the real tracker. Use local only when testing the API itself.
- Auth: `X-Internal-Api-Key: <V1_API_KEY>` on every request. Never commit the key.
- Post comments as Maximus: `authorId: "cmo365psl000vdrd0p63lirlz"` — **production only**. Maximus does not exist in the local dev DB. For local v1 API calls that require an authorId, use Alice Chen (`cmo37pswr00007vd13y3cgzqz`).
- **The `mcp__claude_ai_JedForge__add_comment`/`create_issue`/`update_issue` connector tools cannot post as Maximus** — they authenticate via the JFR-100 OAuth flow bound to Jamie's own account, with no `authorId` override in their schema, so anything posted through them lands under Jamie Edmondson's name. For a Maximus-authored fix-summary comment, always call the production v1 REST API directly (Python `urllib`, see below) instead of the MCP tool.
- **`GET /api/v1/projects` returns `{ projects: [...] }`, not a plain array** — access the list as `data['projects']`, not `data` directly.
- `statusId` accepts a cuid, a human name (`"Done"`), or a category key (`"DONE"`) — all three forms work.
- `IssueStatus` enum is gone — use `ProjectStatus` rows. `IssuePriority`: `CRITICAL | HIGH | MEDIUM | LOW`.
- **Use Python `urllib` for API calls whose JSON body contains backticks** — bash interprets backticks in curl `-d` strings as command substitution, causing the call to fail silently with a 500. `python3 -c "..."` double-quoted strings have the **same problem** — bash still expands backticks inside `"`. Use `python3 -c '...'` (single-quoted outer string, no literal single quotes in data) or a heredoc Python script (`python3 << 'PYEOF' ... PYEOF`) instead.
- **Issue creation is `POST /api/v1/issues` with `projectId` in the body** — there is no `/api/v1/projects/[key]/issues` route; using it returns 404. `projectId` must be the cuid, not the project key. Get the cuid from `GET /api/v1/projects` if you only know the key.
- **`GET` and `PATCH /api/v1/issues/[id]` accept the issue key** (e.g. `JFR-88`) as well as the cuid. Using a cuid for PATCH returns 404 — always use the key form (e.g. `JFR-88`) for single-issue operations.
- **Comments endpoint is `POST /api/v1/issues/[key]/comments`** — there is no `/api/v1/comments` route; posting to it returns 404. Body: `{ authorId, body }` (HTML string).

---

## Local dev environment (Windows / Jed's machine)

- **Local `.env` exists** — `/home/jamie/Projects/TaskForge/.env` is present and contains `V1_API_KEY`, `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`. If it ever goes missing, recreate from `.env.example` and re-add secrets from Railway.
- Docker Postgres on port 5433 — start with `docker start taskforge-db` if not running (see startup checklist above).
- Seeded test users (all password `password123`): `admin@taskforge.dev` (Alice Chen, `UserRole.ADMIN` — use this account to test any admin-gated feature), `member@taskforge.dev`, `carol@taskforge.dev`, `dave@taskforge.dev`.
- Seeded local projects (keys): `PL` (Product Launch), `MA` (Mobile App), `WR` (Website Redesign), `JFR` (JedForge Roadmap). Production has additional projects (`TFEN`, `JFDOCS`, `WEQUIZ`, etc.) that do not exist in local dev.
- Production URL: `https://www.jedforge.com` (also accessible at `https://taskforge-production-099b.up.railway.app`).

See `.context-docs/local-dev-tooling.md` for the Railway CLI/GraphQL API workarounds, seeded-user org-membership nuance, Playwright setup and gotchas, icon/logo asset crop details, and psql/execSync quoting.

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

See `.context-docs/middleware-patterns.md` for all 7 patterns. Key facts:

- Server component layouts read the current path via `headers().get('x-pathname')` (set by `src/middleware.ts`), not from `params` — used to gate non-member access and to distinguish docs paths.
- Use `PageTitleContext` (`<SetPageTitle title={...} />`) to fix breadcrumbs whose last URL segment is a cuid.
- `token.orgId` resolution is non-deterministic for multi-org users (JFR-109) — check which org a session resolved to before assuming a permissions bug.
- Call `router.refresh()` after client mutations that a parent Server Component reads from the DB, or navigating back within ~30s serves stale data.
- `[projectKey]/layout.tsx` now propagates `h-full`/flex height down to project sub-pages (needed for the Kanban board's own-column scrolling) — don't strip this without checking what depends on it.

---

## Server action pitfalls

- **`e.repeat` guard on keyboard handlers** — any `onKeyDown` handler that calls a server action (or any expensive async operation) must check `!e.repeat`. Browsers fire repeated `keydown` events while a key is held, and React's async state updates won't have reflected `isLoading: true` before the repeats fire. Missing this caused the JFR-79 crash: each repeat triggered `runQuery` which runs two parallel Prisma queries, exhausting Railway's connection pool before the first response returned.

- **Next.js redacts thrown Error messages from Server Actions in production** — in `next start` mode, any `throw new Error("my message")` inside a Server Action is replaced with a generic digest string on the client ("An error occurred..."). This only happens in production; local `next dev` shows the real message. For expected validation/guard failures that must show a specific message to the user, **return a discriminated union instead of throwing**: `return { success: false, error: "my message" }`. The client checks `if (!result.success) toast.error(result.error)`. Genuine unexpected errors (DB down, programming bugs) can still throw — those are supposed to hit the generic error boundary. The admin panel (`src/app/(dashboard)/admin/actions.ts`) uses `ActionResult` / `InviteResult` types for this pattern.

---

## Testing

See `.context-docs/testing-notes.md` — hand-written Prisma mocks in `tenancy.test.ts` (and other test files) must be updated when adding models/methods to admin actions; behavior assertions there also assume the throw-based error pattern, not the `{ success, error }` pattern from Server Action pitfalls above.

---

## Data integrity invariants

See `.context-docs/data-integrity.md` for full details. Key facts:

- Issue key generation and kanban position writes are wrapped in `prisma.$transaction` with row-level locks.
- S3 objects are cleaned up on delete (issues, doc sections, project delete).
- Notification cap = 100; PageRevision cap = 50.
- `SavedFilter` requires `projectId` — global `/search` page cannot save/load filters.

---

## External REST API

Customer-facing API at `/api/external/v1/`, org-scoped API keys (separate from the internal v1 and OAuth/MCP auth systems). See `.context-docs/external-api.md` for the auth guard, org-isolation rules, and shared helpers.

---

## MCP OAuth & Streamable HTTP server (JFR-100)

OAuth 2.1 authorization server + MCP server backing the Claude.ai custom connector, at `/api/oauth/*` and `/api/mcp`. A third auth system, distinct from the internal v1 and external org-API-key APIs (each org's tokens/codes are sha256-hashed, never plaintext). See `.context-docs/mcp.md` for the full endpoint list, PKCE/token-rotation details, tool surface, and tenancy rules.

---

## Security constraints

- **AI Chat is Jamie-exclusive, never for a buyer/other entity** — gated behind `AI_CHAT_ENABLED` (`src/lib/ai/feature-flag.ts`), checked server-side in both `/api/ai/*` routes (404 when off, not 403 — a disabled instance shouldn't reveal the routes exist) and in the issue detail page before rendering `AiChatPanel`. Defaults to unset/`false`; only Jamie's own deployment sets it `true`. If the product is ever sold or transferred, the buyer's environment must not have this var set.
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
- .context-docs/closed-projects.md — all 8 closed-project rules
- .context-docs/email.md — Resend/React Email lazy-instantiation and render() gotchas
- .context-docs/migrations.md — non-interactive-TTY workaround, Board/Column dead code
- .context-docs/local-dev-tooling.md — Railway CLI/GraphQL API, seeded-user org nuance, Playwright, icon assets, psql/execSync quoting
- .context-docs/middleware-patterns.md — path-in-layout, breadcrumb titles, invite exemption, JWT orgId, router cache
- .context-docs/testing-notes.md — tenancy.test.ts Prisma mock maintenance
- .context-docs/external-api.md — external v1 API auth guard, org isolation, helpers
- .context-docs/mcp.md — MCP OAuth authorization server + Streamable HTTP server (JFR-100 B1/B2)
- .context-docs/ai-chat.md — AI Chat panel (JFR-111/112): production-only testing, MCP SDK content-block shapes, internal token minting
