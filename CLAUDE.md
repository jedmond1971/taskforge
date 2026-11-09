# TaskForge / JedForge — Codebase Notes

## Session workflow

### Startup checklist (run at the beginning of every session)
1. `git status` — confirm the working tree is clean before starting. Commit or stash any pre-existing changes first.
2. `docker start taskforge-db 2>/dev/null; docker ps --filter name=taskforge-db --format "{{.Status}}"` — confirm Postgres is running. **Empty output means the container doesn't exist at all** (confirmed happens in a fresh environment, 2026-08-06) — `docker start` on a nonexistent container fails silently rather than erroring. See `.context-docs/local-dev-tooling.md` for the recreate-and-reseed recipe.
3. Find or create a JedForge issue for the work ahead. Open production projects: **JFR** (JedForge work), **WEQUIZ**, and **SECH** (Security Hardening — confirmed open 2026-09-09, tracking issues like SECH-82) — TFEN and JFDOCS are closed; **no external security review/pen test is planned** (SECH-98 and SECH-122 set to `Canceled` 2026-09-30 at Jamie's direction — don't re-propose one; SECH-101/123 remain as the internal release gate, minus a review report); use JFR for new JedForge-tooling issues, but work an existing ticket (e.g. a SECH-* issue) directly when one is named. See `CLAUDE_API.md` → Working Convention.

### Pre-commit checklist (run before every commit)
1. `npm run lint` — zero errors required. Pre-existing warnings are acceptable; new ones are not.
2. `npx tsc --noEmit` — zero type errors required.
3. `npm test` — zero failures required. This step was missing from this checklist until JFR-131 (2026-08-13): lint and tsc both passed locally while a hand-written test mock (see `.context-docs/testing-notes.md`) was stale, and CI caught it on push instead. Run it locally before pushing, not just as a CI backstop.
4. `git diff --name-only --cached` — verify only files changed in this session are staged.

**If `tsc --noEmit` fails with "Cannot find module" for a route you just deleted** — run `rm -rf .next/types` and re-run. The generated dir is rebuilt by the next `next build`/`next dev`. (Corrected 2026-09-24: the older advice here was to delete `.next/types/app/api/<path>/`, which does **not** clear it — the dangling reference lives in `.next/types/validator.ts`, so tsc keeps failing until the whole `types` dir goes.)

**`[...new Set()]` spread fails TypeScript (TS2802)** — The project's TypeScript target does not support iterating Sets via spread. Use `Array.from(new Set(...))` instead.

### Shipping: PR flow — `main` is protected (SECH-102)
Direct pushes to `main` are rejected (`GH006`). Branch → `git push -u origin HEAD` → `gh pr create --base main --fill` → wait for the 4 required checks (`Verify`, `Integration (cross-tenant)`, `Secret scan`, `Dependency audit`) → `gh pr merge --squash --delete-branch`. Auto-merge is disabled; `gh pr edit` and `gh pr update-branch` are broken in the installed `gh` 2.45.0 (use `gh api -X PATCH` / `git merge origin/main`). Trust `gh pr view --json mergeStateStatus,headRefOid` over `mcp__ccd_pr__get_status`, whose cache lags. After merging you are left on `main`: `git checkout -b <branch>` before the next commit. Never lift protection without Jamie's explicit approval.

### After merging
Railway auto-deploys `main`; watch the push-event CI run for the merge SHA (filter on `headSha` **and** `event=="push"`), then confirm deploy via the `deployments(...)` query's `meta.commitHash` + `SUCCESS` (a `307 → /login` proves nothing). If CI fails, fix via a new PR. Full recipes, polling loops and gotchas: `.context-docs/ship-and-deploy.md` (also `release-controls.md`).

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
9. **Adding a group member** (`addGroupMember`, JFR-102) — Validates that the target user has an `OrgMember` row for the group's org before creating the `GroupMember`, mirroring invariant #3. A `Group` only ever boosts what a user can do where they're already a `ProjectMember`/`OrgMember` — it never grants visibility or membership on its own (see "Additive RBAC layer" below).
10. **`canManageGroups` is role-only, never boostable by a Group grant** — Groups themselves are managed only by `OrgRole` OWNER/ADMIN (`src/lib/permissions.ts`). A Group can never grant the ability to create/edit more Groups; that would be a self-granting privilege-escalation loop.

**Any org member can create a project — there is no role check (2026-10-07, JFR-186)** — `POST /api/projects` only verifies a live `OrgMember` row for the session org, then makes the caller `PROJECT_LEAD`. No `Permission` enum value covers project creation or org invites (`PROJECT_MANAGE_MEMBERS` is per-project), so Groups can't grant either. The dashboard first-run checklist (`src/lib/onboarding.ts`) deliberately shows steps only to org OWNER/ADMIN/platform admins, which is stricter than the API; its dismissal is per-browser `localStorage`, since there is no user-preferences table.

**There is no feature to move a project between organizations** — neither in the UI, admin actions, nor the v1 API. When a move is needed, do it via direct SQL in a single transaction: upsert `OrgMember` rows (MEMBER) in the target org for every `ProjectMember` of the moving project first, then update `Project.orgId` — otherwise invariants 2–5 break. `OrgMember.id` has no DB default (Prisma generates cuids); `gen_random_uuid()::text` works for manual inserts.

**`ProjectMember` has no timestamp columns** — the table schema is `(id, "userId", "projectId", role)` only. Direct psql inserts must omit `createdAt`/`updatedAt`: `INSERT INTO "ProjectMember" (id, "userId", "projectId", role) VALUES (gen_random_uuid()::text, ..., 'TEAM_MEMBER') ON CONFLICT DO NOTHING`.

**`CustomFieldValue` has `updatedAt` but no `createdAt`** — the model uses `@updatedAt` (auto-managed by Prisma) but has no `createdAt` field. Direct psql inserts must include `"updatedAt"` explicitly (use `now()`); omitting it causes a not-null violation.

**`ApiKey.createdById` uses `ON DELETE RESTRICT`** — you cannot delete a `User` who has created API keys; the FK violation will abort the delete. Any future admin user-deletion action must revoke (set `revokedAt`) or reassign all `ApiKey` rows for that user first.

**Non-goals (do not implement without a separate product decision):**
Org switching UI, billing changes, broad project membership role redesign, cascading project deletion on org delete.

---

## Closed project invariants

See `.context-docs/closed-projects.md` for all 9 rules. Key facts:

- `isClosed` (admin-only close/reopen) is the only project deactivation mechanism — there is no Archive concept.
- Active Projects page, Dashboard, and closed-project URLs (except `/projects/[key]/docs`) filter or redirect on `isClosed`.
- `/projects/closed` is visible to everyone; non-admins see only projects they're a member of.
- **Writes are locked at the session layer too, not just page redirects (SECH-93, 2026-09-22):** `requireProjectRole` rejects writes on a closed project unless the caller is a platform `ADMIN`; the local `requireProjectMember` in `projects/[projectKey]/actions.ts` delegates to it. Docs stay read-only rather than fully blocked (`isDocsWriteLocked()` in `src/app/api/docs/_helpers.ts`, gates all 8 doc write routes + MCP's `write_doc_page`) — reads are unaffected everywhere.

---

## Additive RBAC layer (Groups, JFR-102)

See `.context-docs/groups-rbac.md` for the full design (Permission enum mapping, mechanism, Phase 1/Phase 2 grant-coverage boundary). Key facts:

- Groups (`Group`/`GroupMember`/`GroupPermission`) only ever **boost** what a user can do where they're already a `ProjectMember`/`OrgMember` — never grants new access on its own. Org tenancy invariants #9–10 above.
- `requireProjectRole`/`requireOrgRole` compute grants automatically and pass them as a second arg to the `check` callback — most `canX(role)` call sites got group-awareness for free with zero changes.
- The docs module, `/api/issues/[issueId]/route.ts`, and the MCP server tool guards call `canX(role)` directly (not through `require*Role`) — these were wired to fetch grants by hand in JFR-121 (Phase 2), so all `canX(role)` call sites in the app are now grant-aware.

---

## UI component library

Uses **`@base-ui/react`** (NOT Radix) — no `asChild` (use `render={<Link href=... />}`), no `Select` or `Tooltip` component (native `<select>`, `title`/`aria-label`). Destructive confirms use `src/components/ui/confirm-dialog.tsx` (closes optimistically; surface failures with a `sonner` toast). Rich text: TipTap v3 (`rich-text-editor.tsx`, extensions in `rich-text-extensions.ts`), read-only `rich-text-display.tsx`, styled by the hand-written `.rich-prose` class (no typography plugin). Plain `<img>` everywhere (no `next/image`). Avoid chaining `dark:` with a responsive variant; hide desktop-only persisted UI with breakpoint CSS, not JS unmounting. Dark theme variables are hex-aligned (JFR-153); light mode is not. Full notes, the token-migration recipe and the `lucide-react` naming gotchas: `.context-docs/ui-components.md`.

## Adding npm packages

`npm install` runs fine in Claude Code's shell in this environment (verified 2026-07-31) — the earlier note that it couldn't be run directly was wrong. To add a package: edit `package.json`, then run `npm install` yourself to update `package-lock.json`, then commit both in the same change. **Do not skip the lockfile update** — CI and Railway both use `npm ci`, which fails with `EUSAGE` if `package.json` and `package-lock.json` are out of sync (this broke a push during the AI Chat work).

**Every dependency must carry a real version range — no dist-tags, wildcards or open-ended `>=` (SECH-126).** `src/__tests__/dependency-pinning.test.ts` fails the build otherwise. `npm ci` resolves from the lockfile, so an unpinned spec looks harmless; the problem is that any `npm install` silently re-resolves it to whatever is newest, with no version gate and no diff to review, and Dependabot never raises a PR for it because there is no range to bump. `@anthropic-ai/sdk` sat on `"latest"` until 2026-09-23. House style is a caret (36 of 40 deps); the exceptions are exact pins — `next`, `eslint-config-next`, `react`, `react-dom`, `@types/react`, `@types/react-dom` — so bumping one (e.g. a `next` security patch) means editing `package.json`, and keep `next` and `eslint-config-next` on the same version. Dependabot groups the React four as the "framework" group; note that on a `0.x` package a caret allows patch releases only.

**Bumping a package family whose peers are pinned to an exact version** (TipTap v3 pins `peer @tiptap/pm@"3.31.3"`, not a range) fails with `ERESOLVE` even when you update every member in `package.json`, because `npm install` tries to preserve the existing lockfile tree. Do **not** fix it with `--force`/`--legacy-peer-deps` (accepts a broken tree) or by deleting `package-lock.json` (re-resolves *everything*, so an unrelated dependency can drift in the same PR). Instead drop just that subtree's entries from the lockfile and reinstall:
```bash
python3 -c "import json;d=json.load(open('package-lock.json'));[d['packages'].pop(k) for k in [k for k in d['packages'] if '@scope/' in k]];d['packages']['']['dependencies']=json.load(open('package.json'))['dependencies'];json.dump(d,open('package-lock.json','w'),indent=2)"
rm -rf node_modules/@scope && npm install
```
Afterwards diff the lockfile for changes *outside* that scope to confirm nothing else moved.

## Email sending (Resend + React Email)

Email templates live in `src/emails/`, send helper `sendOrgInviteEmail()` in `src/lib/invites.ts`. See `.context-docs/email.md` for the Resend lazy-instantiation and `render()`-before-send gotchas.

## Subagent file-write limitation in worktrees

Worktree agents (`isolation: "worktree"`) can read and run bash but cannot Edit/Write source files. Do all file editing in the main context after the subagent returns its findings.

**A worktree created under `.claude/worktrees/` (nested inside the repo) breaks `next lint` and `npm test` while it exists** — see `.context-docs/local-dev-tooling.md` → "Nested worktree tooling conflicts" for the lint workaround and why `npm test` from the main checkout double-runs (and flakes) every test file until the worktree is removed. Always remove/exit the worktree before trusting a "final" `npm test` run on the main checkout.

---

## Database migrations

For local dev (Docker Postgres on port 5433): `npx prisma migrate dev`. Always update `prisma/schema.prisma` first and run `npx prisma generate` after schema changes. Production migrations auto-apply on every Railway deploy (`preDeployCommand` in `railway.toml`) — no manual step needed.

**Before writing any route or server action that queries Prisma, verify every field referenced exists in the current `schema.prisma`.** If a field is absent, note it and either adapt the query or plan a migration before proceeding.

**Don't run `prisma format` on `schema.prisma`** — adding a longer field name makes it re-align every line of the block (and an unrelated model), turning a 16-line change into a noisy diff; add the lines unaligned (Prisma accepts it) and use `npx prisma validate` instead. See `.context-docs/migrations.md` for the non-interactive-TTY workaround and the `Board`/`Column` dead-code note.

---

## Internal v1 REST API

Internal API for Claude Code to track work (`CLAUDE_API.md`). **Create an issue at the start of every non-trivial task**, against **production** (`https://taskforge-production-099b.up.railway.app/api/v1`), auth `X-Internal-Api-Key: <V1_API_KEY>` (never commit it; `set -a; source .env; set +a` before Python/curl). Post comments as Maximus (`authorId: "cmo365psl000vdrd0p63lirlz"`, production only) via direct REST, not the JedForge connector tools (those post as Jamie). Use the issue **key** for `GET`/`PATCH /issues/[key]`; `POST /issues` needs the project cuid (JFR: `cmouj659w0001pypck86hd56i`); JFR statuses are Backlog/Ready/In Progress/Done. Use quoted-heredoc Python for bodies with backticks. Endpoint quirks, status/type enums and the parent-linking workaround: `.context-docs/v1-api-notes.md`.

## Local dev environment

Primary dev machine is Jed's Windows PC (Node 20, Docker Postgres `taskforge-db` on 5433, local `.env` that is gitignored); a Proxmox dev container also exists. Seeded users are `admin@jedforge.dev` (Alice Chen, ADMIN), `member@`, `carol@`, `dave@` — password `password123`; seeded projects `PL`, `MA`, `WR`. `npm run lint` baseline is 39 warnings, 0 errors. `prisma/seed.ts` is guarded against non-local DBs. After a schema change **restart the dev server**; stale dev CSS: `rm -rf .next/dev/cache`. The local `.env` has a real `RESEND_API_KEY` — test mail flows with non-existent addresses. Railway log-stream and `variables(...)` GraphQL queries and secret-store writes are blocked by the classifier — don't work around them. Everything else (browser-pane quirks, `preview_start` issues, test-data recipes, Railway `deployments` query details, stray untracked files): `.context-docs/local-dev-environment.md`.

## Sprint workflow (JFR-105)

See `.context-docs/sprints.md` for all 10 rules. Key facts:

- `Project.workflowMode` (`KANBAN` default, or `SPRINT`) is set once at creation and never changeable afterward — no UI/admin/API path to switch an existing project.
- Sprint-mode projects get a `Backlog` tab and a Board scoped to only the active sprint's issues; Kanban-mode projects are completely unaffected.
- "One active sprint per project" is enforced by a DB partial unique index, not just app logic — see `.context-docs/data-integrity.md`.
- `moveIssue`/`reorderIssues` gained an optional `sprintScopeId` param so drag-and-drop on a sprint-scoped board only reindexes the visible subset of a shared status column — required for correctness, not optional polish.

## Docs module invariants

See `.context-docs/docs-invariants.md` for all 13 rules. Key facts:

- DocSpaces are lazy-upserted via `resolveDocCtx` (`src/app/api/docs/_helpers.ts`) — do not pre-create them.
- `DocPageType`: `NATIVE` (TipTap HTML) or `DOCUMENT` (file upload). No other types.
- Role enforcement: read = any member (or any authed user if `isPublic`); edit = `TEAM_MEMBER+`; delete = `PROJECT_LEAD`.
- Page revisions auto-snapshot on every content save; cap = 50.
- `DocSpace.isPublic` is **org-scoped, not cross-tenant** (SECH-95): a non-member reads a public docspace only with an `OrgMember` row for `Project.orgId`, enforced in `resolveDocCtx` (API routes + MCP only — the docs UI layout still requires `ProjectMember`).
- `DocPage.status` (`DocPageStatus`: `DRAFT | IN_REVIEW | PUBLISHED`, default `PUBLISHED`, JFR-133) is display-only, not an access gate.
- `DocPageView` (JFR-133) tracks per-user recently-viewed pages, written directly from the doc-detail Server Component, not a REST endpoint.
- TOC heading-id extraction (`rich-text-display.tsx`) is client-side and its `useEffect` must stay dependency-array-free — see rule 13 in docs-invariants.md for why.

---

## Functional specification

Spec: `.context-docs/JedForge-FunctionalSpec-v2.0.docx` — regenerate with `node scripts/generate-spec-v2.mjs`, then commit both files.

**Tooling notes for .docx:**
- Read with `python3` + `python-docx` (`pip3 install python-docx --break-system-packages`). `extract-text` does not exist.
- `docx` npm package: `/home/jamie/.npm-global/lib/node_modules/docx`, import via `dist/index.mjs`. Font `size` is half-points: 10pt = `size: 20`.

---

## Middleware and server component patterns

See `.context-docs/middleware-patterns.md` for all 8 patterns. Key facts:

- Server component layouts read the current path via `headers().get('x-pathname')` (set by `src/middleware.ts`), not from `params` — used to gate non-member access and to distinguish docs paths.
- Use `PageTitleContext` (`<SetPageTitle title={...} />`) to fix breadcrumbs whose last URL segment is a cuid.
- `token.orgId` resolution is non-deterministic for multi-org users (JFR-109) — check which org a session resolved to before assuming a permissions bug.
- Call `router.refresh()` after client mutations that a parent Server Component reads from the DB, or navigating back within ~30s serves stale data.
- `[projectKey]/layout.tsx` now propagates `h-full`/flex height down to project sub-pages (needed for the Kanban board's own-column scrolling) — don't strip this without checking what depends on it.

---

## Server action pitfalls

- **A `"use server"` file may only export async functions** — a `export const MAX_NAME_LENGTH = 100` next to an action fails the Next build, and `tsc`/`lint`/`npm test` all pass. Keep helper constants module-private (`const`, not `export`) or move them to a non-action file (hit 2026-10-02, JFR-170; caught before pushing).

- **`e.repeat` guard on keyboard handlers** — any `onKeyDown` handler that calls a server action (or any expensive async operation) must check `!e.repeat`. Browsers fire repeated `keydown` events while a key is held, and React's async state updates won't have reflected `isLoading: true` before the repeats fire. Missing this caused the JFR-79 crash: each repeat triggered `runQuery` which runs two parallel Prisma queries, exhausting Railway's connection pool before the first response returned.

- **Next.js redacts thrown Error messages from Server Actions in production** — in `next start` mode, any `throw new Error("my message")` inside a Server Action is replaced with a generic digest string on the client ("An error occurred..."). This only happens in production; local `next dev` shows the real message. For expected validation/guard failures that must show a specific message to the user, **return a discriminated union instead of throwing**: `return { success: false, error: "my message" }`. The client checks `if (!result.success) toast.error(result.error)`. Genuine unexpected errors (DB down, programming bugs) can still throw — those are supposed to hit the generic error boundary. The admin panel (`src/app/(dashboard)/admin/actions.ts`) uses `ActionResult` / `InviteResult` types for this pattern.

---

## Testing

**Before touching auth, `permissions.ts`, server actions or API routes, also run `npm run test:integration`** (DB-backed cross-tenant suite, needs the local Docker DB; also runs in CI as the parallel `integration` job with a Postgres service — see `.context-docs/testing-notes.md`). Every route handler and server action must have a row in `.context-docs/authz-matrix.md` (`authz-matrix.test.ts` enforces it). Likewise every export of `admin/actions.ts` must be added to `everyAdminAction()` in `src/integration/admin-actions.itest.ts`, or the integration job fails (SECH-97).

**Stored XSS is covered by a standing suite (SECH-106)** — one corpus in `src/test-support/xss-payloads.ts` drives `xss-corpus.test.ts` (both sanitizers, hermetic) and `src/integration/stored-xss.itest.ts` (every persistence path, real DB). `rich-text-sinks.test.ts` is the guard that matters day to day: **adding a Prisma write to `description`/`body`/`content` without a sanitizer, or a new `dangerouslySetInnerHTML`, fails `npm test`** until you either wrap it or add a documented exception. Don't add an exception without checking the sink half — an unsanitized value is only safe while nothing renders it as markup.

**Secret comparisons are guarded (SECH-109)** — `src/__tests__/constant-time-secrets.test.ts` fails if a listed auth file compares a secret or its digest with `===`/`==` instead of `timingSafeEqual`. Adding a new place that compares a caller-supplied secret to a stored one means using a constant-time primitive and adding the file to `COMPARISON_SITES`. Lookups that hand the digest to the DB (`findUnique({ where: { hashedToken } })`) don't belong there — there's no comparison in our code to get wrong. The SH-021 scenario-to-test matrix lives in `.context-docs/mcp.md`.

See `.context-docs/testing-notes.md` — hand-written Prisma mocks in `tenancy.test.ts` (and other test files) must be updated when adding models/methods to admin actions; behavior assertions there also assume the throw-based error pattern, not the `{ success, error }` pattern from Server Action pitfalls above.

---

## Data integrity invariants

See `.context-docs/data-integrity.md` for full details. Key facts:

- Issue key generation and kanban position writes are wrapped in `prisma.$transaction` with row-level locks — **true for the UI's `moveIssue`/`reorderIssues` actions, but not for the v1 API's `POST /api/v1/issues` or `PATCH /api/v1/issues/[key]`**, which do a plain non-transactional `count()`-based position write; this gap is the root cause of a known position-collision bug (JFR-122).
- S3 objects are cleaned up on delete (issues, doc sections, project delete), and a daily GitHub Actions cron (`.github/workflows/cleanup-orphaned-attachments.yml`, this app's only scheduled job) deletes attachment objects orphaned by abandoned presigned uploads.
- Org storage quota (flat 5 GB, not per-user, not tied to `Organization.plan`) is enforced at every attachment/doc-file upload path — see `src/lib/storage-quota.ts`.
- Notification cap = 100; PageRevision cap = 50.
- `SavedFilter` requires `projectId` — global `/search` page cannot save/load filters.
- **`DocPage.position` DOES have a DB-level unique constraint** — a DEFERRABLE unique on `(sectionId, position)` plus a non-deferrable partial index for unsectioned pages (migration `20260601000000_position_uniqueness`). Any code writing multiple DocPage positions across separate requests (not one shared transaction) must renumber through a temporary offset first to avoid a 409 — see `persistListOrder` in `docs-sidebar-layout.tsx`.

---

## External REST API

Customer-facing API at `/api/external/v1/`, org-scoped API keys (separate from the internal v1 and OAuth/MCP auth systems). See `.context-docs/external-api.md` for the auth guard, org-isolation rules, and shared helpers.

---

## MCP OAuth & Streamable HTTP server (JFR-100)

OAuth 2.1 authorization server + MCP server backing the Claude.ai custom connector, at `/api/oauth/*` and `/api/mcp`. A third auth system, distinct from the internal v1 and external org-API-key APIs (each org's tokens/codes are sha256-hashed, never plaintext). See `.context-docs/mcp.md` for the full endpoint list, PKCE/token-rotation details, tool surface, and tenancy rules.

---

## Security constraints

Full notes with rationale and incident history: `.context-docs/security-constraints.md`. Rules to keep in mind:

- **No mass assignment** — copy an explicit field whitelist into Prisma `data:`; verify every client-supplied id (`statusId`, `parentId`, `sectionId`, `orgId`…) belongs to the caller's project/org.
- **Use the shared guards in `src/lib/permissions.ts`** (`requireAdmin`, `requireProjectRole`, `requireProjectRoleById`); edit-type gates use `canEditIssues(role, grants)`.
- **CSP/headers live in `next.config.mjs`** and `security-headers.test.ts` pins the exact source lists — a new external source means editing both.
- **Uploads are raster-only, downloads never inline by default** — use `validateRasterImage()`/`sniffRasterFormat()`; every `getPresignedDownloadUrl()` passes `{ contentType, fileName }`.
- **Dependency audit gate** fails on high/critical prod advisories not in `.security/audit-allowlist.json`; fix a new advisory in its own PR from `origin/main`.
- **Secret scanning** runs gitleaks over full history — never commit real secrets; rotate instead of allowlisting.
- **No `console.*` in app code** — use `logError(context, error)`; never pass a raw error to a console method. **`securityEvent()`** is the only security-log sink.
- **v1 API needs `X-Internal-Api-Key`** (constant-time compare); `GET /api/avatar` needs a session.
- **TipTap HTML is sanitized server-side** via `sanitizeTipTapHtml()` before every persist; `ALLOWED_TAGS` must cover everything `getHTML()` emits.
- **Owner alerting** never emits security events and must not use the shared Prisma client (`.context-docs/alerting.md`).
- **Comment edit/delete and attachment delete require current membership.**
- **Session invalidation via `User.sessionVersion`** — `auth()` is fail-closed; new dashboard `page.tsx`/`layout.tsx` must call `await requireUser()`; never call the raw NextAuth session; credentials (OAuth tokens, API keys) are revoked push-style via `src/lib/credential-revocation.ts`.

## Reference docs (load when relevant)

- .context-docs/shortcuts.md — global/project/issue keyboard shortcuts, the `?` help overlay and shared registry `src/lib/shortcuts.ts` (JFR-177 — new shortcuts must be added there), and the Cmd/Ctrl+K command palette (JFR-176: `CommandPalette`, `paletteSearch` gated on `getCurrentUser()` + member/non-closed scope, `jedforge:open-palette` / `jedforge:create-issue` events)
- .context-docs/search-approach.md — why palette content search is `ILIKE` + app-side HTML stripping/snippets rather than tsvector, benchmark numbers, the pg_trgm escalation recipe, public-docspace exclusion (JFR-193/194)
- .context-docs/rate-limiting.md — durable limiter (failure vs attempt counting, `LIMITS` table for every sensitive endpoint, `RATE_LIMIT_MODE=monitor` rollback switch, fail-closed policy), leftmost-XFF client IP (Railway appends a per-request internal hop — rightmost silently disables limits), prod-verified behaviour + re-verify recipe (SECH-82/108)
- .context-docs/log-redaction.md — the three log leak sources and how each is closed, the never-log list, why `code` and cuids are deliberately preserved, the opt-in cap, and how to add a sensitive key (SECH-115)
- .context-docs/security-events.md — structured security-event catalog, severity map, denial classification (why two denials are deliberately silent), the emit() seam for SECH-115/117, request-ID propagation and the /api/auth matcher gap (SECH-114)
- .context-docs/alerting.md — owner alerting (SECH-117): rules/thresholds, Postgres cooldown claim, global cap, config, never-list, how to add a rule, external site-down monitor
- .context-docs/secret-scanning.md — gitleaks CI job (full history, self-test canary, allowlist rules), exact-value history search, 2026-09-22 baseline incl. the historical committed `.env` (SECH-112)
- .context-docs/kill-switches.md — `OAUTH_MCP_ENABLED` / `UPLOADS_ENABLED` / `EXTERNAL_API_ENABLED` (default on; `false` → 503 from middleware), how to flip in Railway, what stays readable, how to add a surface (SECH-118)
- .context-docs/password-reset.md — forgot/reset-password flow (JFR-183): hashed single-use token claimed by delete, no-enumeration via `after()` + typed-input-only limits, what a reset invalidates, local testing recipe
- .context-docs/secret-rotation.md — env-var inventory (names only), per-secret rotation steps + user impact, rotation log; `V1_API_KEY` has THREE copies (Railway, local .env, GitHub Actions secret) (SECH-113)
- .context-docs/release-controls.md — branch protection on main, PR ship flow, adding required checks, break-glass (SECH-102)
- .context-docs/sprints.md — all 10 Sprint workflow rules (workflowMode lock, board scoping, one-active-sprint DB constraint, sprintScopeId)
- .context-docs/docs-invariants.md — all 13 Docs module rules (DocSpace, roles, revisions, file lifecycle, delete UI, status, recently-viewed, TOC extraction)
- .context-docs/data-integrity.md — A2 audit invariants (key gen, kanban positions, S3 cleanup, caps, storage quota, orphan-cleanup cron)
- .context-docs/rich-text.md — TipTap packages, HTML storage, empty-state normalization
- .context-docs/notifications.md — trigger points, known gaps, UI entry points, server actions
- .context-docs/avatars.md — S3 upload, proxy route, session refresh
- .context-docs/roadmap-workflow.md — JFR project workflow for roadmap items
- .context-docs/closed-projects.md — all 9 closed-project rules
- .context-docs/groups-rbac.md — additive Groups/RBAC design (JFR-102), Permission mapping, Phase 1/Phase 2 grant-coverage boundary
- .context-docs/email.md — Resend/React Email lazy-instantiation and render() gotchas
- .context-docs/migrations.md — non-interactive-TTY workaround, Board/Column dead code
- .context-docs/local-dev-tooling.md — Railway CLI/GraphQL API, seeded-user org nuance, Playwright, icon assets, psql/execSync quoting
- .context-docs/middleware-patterns.md — path-in-layout, breadcrumb titles, invite exemption, JWT orgId, router cache
- .context-docs/testing-notes.md — tenancy.test.ts Prisma mock maintenance; DB-backed cross-tenant integration suite (`npm run test:integration`)
- .context-docs/authz-matrix.md — every route handler and server action: auth mechanism, tenant scope, minimum role; audit findings (SECH-85)
- .context-docs/external-api.md — external v1 API auth guard, org isolation, helpers
- .context-docs/mcp.md — MCP OAuth authorization server + Streamable HTTP server (JFR-100 B1/B2); refresh-token family revocation and why reuse != the concurrent-claim race (SECH-109); SH-021 token verification matrix (scenario → test)
- .context-docs/ship-and-deploy.md — full PR-merge/CI-wait/Railway-deploy recipes and gotchas (moved out of CLAUDE.md)
- .context-docs/ui-components.md — Base UI gotchas, redesign-token migration recipe, lucide naming, sidebar/dark-mode rules
- .context-docs/v1-api-notes.md — internal v1 REST API endpoint quirks, statuses/types, Maximus comments
- .context-docs/local-dev-environment.md — dev machine setup, browser-pane quirks, test-data recipes, Railway query notes, stray files
- .context-docs/security-constraints.md — full security constraints with rationale (CSP, uploads, audit gate, logging, sessions)
