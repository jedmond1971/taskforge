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

### Shipping: PR flow — `main` is protected (SECH-102, 2026-09-22)
**Direct pushes to `main` are rejected** (`GH006`). Branch protection requires the `Verify`, `Integration (cross-tenant)`, `Secret scan` and `Dependency audit` checks with admins included, so it applies to Claude Code's `jedmond1971` pushes too. Commit on a branch, then run `git push -u origin HEAD`, `gh pr create --base main --fill`, then read CI with the desktop app's `mcp__ccd_pr__get_status` tool (the app forbids polling `gh pr checks --watch`; `get_status` returns `checks.passing/failing/pending` and `mergeStateStatus`; **its cache lags a fresh push** — right after pushing it keeps reporting the previous head's 4 passing checks and a stale `CONFLICTING`/`DIRTY`, so when it disagrees with `gh pr view <N> --json mergeStateStatus,headRefOid` (`BLOCKED` = required checks still running, `CLEAN` = mergeable) trust `gh`, and confirm `headRefOid` equals your local `git rev-parse HEAD`), and `gh pr merge --squash --delete-branch`. When `main` has moved, the merge is refused ("head branch is not up to date") — `gh pr update-branch` does **not** exist in the installed `gh` 2.45.0, so update the branch yourself: `git merge origin/main` on the branch, push, and wait for CI to re-run. **`gh pr edit` is also broken in `gh` 2.45.0** (fails with a "Projects (classic) is being deprecated" GraphQL error and changes nothing) — edit a PR body with `gh api -X PATCH repos/jedmond1971/taskforge/pulls/<N> -F body=@<file>` instead. **Auto-merge is not available** — the repo has it disabled, so `mcp__ccd_pr__set_auto_merge` fails with "Auto merge is not allowed for this repository"; "merge once CI passes" means checking `get_status` for `passing` = all and `mergeStateStatus: CLEAN`, then running `gh pr merge --squash --delete-branch` yourself. **`get_status` reports `0/0/0` checks for the first moments after `gh pr create` — that is CI not yet registered, not "no CI"**; the four checks take roughly 1–3 minutes. **Never lift protection (break-glass) without Jamie's explicit approval in the session.** The full recipe, the break-glass procedure, and how to add a newly required check live in `.context-docs/release-controls.md`.

**Waiting for required checks:** a Bash call that *starts* with `sleep N` is rejected by the harness ("use Monitor"), but a loop with the sleep inside runs fine and needs no polling tool: `for i in $(seq 1 36); do s=$(gh pr view <N> --json mergeStateStatus --jq .mergeStateStatus); [ "$s" = CLEAN ] && break; sleep 15; done`, then print `mergeStateStatus,headRefOid,statusCheckRollup` and compare `headRefOid` with `git rev-parse HEAD` before `gh pr merge`. Used for six PRs on 2026-10-02; `CLEAN` arrived in ~1–3 min each time.

**After `gh pr merge --squash --delete-branch`, the local checkout is left on `main`** (the merged branch is gone, but you're not automatically switched anywhere else) — confirmed 2026-09-28 when a second, unrelated fix got committed straight onto local `main` right after a merge instead of a fresh branch. If this happens: `git branch <new-branch-name>` at the current HEAD to save the commit, then `git reset --hard origin/main` to restore local `main`, then `git checkout <new-branch-name>` and push/PR normally — nothing improper reaches the remote as long as you catch it before pushing. Always run `git checkout -b <branch>` (or confirm your branch) immediately after a merge, before the next commit.

### After merging
Railway deploys the merge commit on `main`, so monitor that CI run to completion before closing the session:
```bash
SHA=$(git rev-parse origin/main)   # after `git fetch`; the squash-merge commit
until gh run list --repo jedmond1971/taskforge --json headSha,status --jq ".[]|select(.headSha==\"$SHA\" and .status==\"completed\")" | grep -q .; do sleep 10; done
gh run list --repo jedmond1971/taskforge --limit 3 --json headSha,conclusion,event
```
**Also filter on `event=="push"`** — runs with `event: "dynamic"` and an empty `conclusion` share the merge SHA and satisfy the `completed` loop at once (2026-10-07), so it returns before CI has run. **Filter on `headSha`, not `--branch main --limit 1` + `grep completed`** — that older loop matched already-finished runs from months ago and returned instantly without waiting for the merge's CI (confirmed 2026-09-30). `gh run list --commit <short-sha>` returns `[]`; don't use a short SHA there. The workflow also runs on `pull_request`, so check `event` is `push` and `conclusion` is `success` for your SHA.
If CI fails, fix it through a new PR before ending the session. Do not leave main in a broken state.

**Railway deploy lag:** CI passing does not mean the production deployment is live. Railway takes an additional ~2–3 minutes after CI success to build and swap the deployment. New API routes will 404 until the deploy completes. If you need to verify a new endpoint is live, poll with `until curl -s -o /dev/null -w "%{http_code}" <url> | grep -q "200"; do sleep 15; done`. **A `307 → /login` from an auth-gated route (e.g. `/admin/*`) proves nothing** — middleware redirects unauthenticated requests whether or not the route exists yet; confirm such a deploy with the `deployments(...)` query's `meta.commitHash` + `SUCCESS` instead.

**Railway auto-deploy-on-push was re-enabled** (status as of 2026-08-11) after being turned off following an incident on 2026-08-05 — merges to `main` go live automatically again, so the normal "After merging" workflow above applies. If a push ever doesn't seem to reach production after the normal CI+build lag, confirm the auto-deploy toggle hasn't been turned off again before assuming a code bug. To manually deploy a specific commit via the Railway GraphQL API (see `.context-docs/local-dev-tooling.md` for auth/IDs): call `serviceInstanceDeploy(serviceId, environmentId, commitSha)` **with an explicit `commitSha`** (full 40-char SHA, `git rev-parse <ref>`) — calling it with no `commitSha`/`latestCommit` arg silently redeploys whatever commit Railway last deployed, not the actual latest commit on the branch. Poll the `deployments(...)` query afterward and match on `meta.commitHash` to confirm the right commit is actually building.

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

This project uses **`@base-ui/react`** (NOT Radix UI). Standard shadcn components that depend on Radix do not exist here. Custom equivalents are built on Base UI primitives.

- `src/components/ui/confirm-dialog.tsx` — use for all destructive action confirmations (not `window.confirm()`); `description` is a plain string, put richer content (a list, counts) in its optional `children`, which render between the header and the buttons (JFR-182). Its `onConfirm` closes the dialog immediately (`onOpenChange(false)` fires right after `onConfirm()`, not after the async work resolves) — the established pattern (`AttachmentsPanel`, doc page delete JFR-132) is to let the dialog close optimistically and surface failures via a `sonner` toast afterward, not to keep the dialog open with a loading state.
- `src/components/ui/rich-text-editor.tsx` — TipTap **v3** editor (v2 until SECH-124, 2026-09-23). Its extension set lives separately in `rich-text-extensions.ts` so tests can drive the real configuration; change extensions there, not in the component.
- `src/components/ui/rich-text-display.tsx` — read-only HTML renderer for TipTap content

See `.context-docs/rich-text.md` for TipTap packages, storage format, and empty-state behavior.

**`.dark`'s shadcn-core CSS variables are now hex-aligned with the redesign palette (JFR-153, 2026-09-28)** — `src/app/globals.css`. The handoff (`Claude Code Handoff.md`) only gives exact hex for about half the slots (`background`, `foreground`, `primary`, `border`, `muted-foreground`, `sidebar`, `sidebar-raised`); the rest (`card`, `popover`, `secondary`, `muted`, `accent`, `destructive`, `input`, `ring`, `sidebar-accent`, `sidebar-primary`, `sidebar-border`, `sidebar-ring`) were derived from actual component usage — see PR #75's description for the full value-by-value rationale before changing any of them again. **Light mode (`:root`) was NOT touched and still mixes oklch with hex** — same issue, out of JFR-153's stated scope; do it as its own pass rather than assuming it's already done. `--chart-1..5` are unused anywhere in the codebase and were deliberately left as-is in both themes.

**No Tailwind typography plugin (`@tailwindcss/typography`) is installed** — there is no `prose`/`prose-invert` class available. Rich-text/HTML content (TipTap output, and now mammoth-converted DOCX preview HTML) is styled via a hand-written `.rich-prose` class in `src/app/globals.css`, applied through `RichTextDisplay` (`src/components/ui/rich-text-display.tsx`). Extend `.rich-prose` with new element rules (e.g. the `table`/`sup`/`sub`/`u` rules added for DOCX preview, JFR-131) rather than reaching for a `prose` class that doesn't exist here.

**The redesign-token migration (JFR-155, closed 2026-09-30) covered the listed *screens*, not every shared component** — a scan for `zinc-` / `bg-white dark:` still hits ~35 files, mostly `src/components/issues` (13), `src/components/docs` (7) and `src/components/ui`, plus a few in `comments`, `projects`, `activity`, `attachments`, the invite page, bulk-edit and hierarchy. Don't assume a file is migrated because its page was. The recipe that worked for JFR-162: replace `bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800` with `bg-surface shadow-[var(--shadow-panel)]`, `text-zinc-*` pairs with `text-foreground`/`text-muted-foreground`, row/header borders with `border-border-soft`, hover with `hover:bg-surface-active`, red/green/amber badge literals with the `danger`/`success`/`warning` (+`-soft`) tokens; **delete** the per-field `bg-zinc-50 dark:bg-zinc-800 …` overrides on `<Input>` (it themes itself) and put native `<select>`s on `border border-input bg-transparent text-foreground`; (their dropdown options are themed globally by a `select option` rule in `globals.css`, JFR-191 — without it a transparent select shows white-on-white options in dark mode); then grep for residue and strip any `className=""` the deletion left behind.

**No `Tooltip` component exists** — `src/components/ui/` has nothing for hover tooltips (checked while building the collapsible sidebar, JFR-101). For icon-only UI, use plain `title`/`aria-label` attributes rather than assuming a themed tooltip is available; building a Base UI Tooltip primitive is a separate, larger piece of scope.

**To render `Button` as a link, use `render={<Link href="..." />}`, not `asChild`** — `@base-ui/react/button` uses Base UI's `render` prop pattern for polymorphism, unlike Radix's `asChild`. Established usage: `AdminProjectsClient.tsx` and the Issues-tab "Bulk Edit" button (`issues/page.tsx`, JFR-138).

**No `Select` component exists either** — enum/dropdown pickers (issue priority, type, status, etc.) all use a plain native `<select>` with a shared Tailwind class string (see `selectClass` / `InlineSelect` in `src/components/issues/IssueDetail.tsx`), not a Base UI Select wrapper. `@base-ui/react` is only used in this codebase for `input`, `button`, `separator`, `menu` (dropdown-menu.tsx, an action list — not a form select), `avatar`, and `dialog`. Match the native-`<select>` pattern for new enum pickers rather than building a Base UI Select wrapper (confirmed while building the board auto-hide-duration picker, JFR-117).

**`lucide-react` icon naming gotcha** — `LinkOff` does not exist in the installed version (1.7.0). The correct name is `Link2Off`. When in doubt, check exports with `node -e "const l = require('lucide-react'); console.log(Object.keys(l).filter(k => /link/i.test(k)))"`. There are no file-format-specific icons in lucide (`FilePdf`, `FileWord`, etc. don't exist) — for real branded file-type glyphs, `src/components/docs/doc-type-icon.tsx` (JFR-128) uses the `react-file-icon` package instead (`FileIcon` + `defaultStyles`, keyed by extension). That package ships no TypeScript types; the ambient module declaration lives in `src/types/react-file-icon.d.ts`.

**No `next/image` usage anywhere in this codebase** — every image (auth page logos, sidebar wordmark/glyph, mobile top bar logo) is a plain `<img>` tag, which is why `npm run lint` already reports several pre-existing `@next/next/no-img-element` warnings. Adding more plain `<img>` tags for logo/icon-style assets, consistent with this existing pattern, will add further warnings of the same type — that's expected and not a "new warning" regression in the sense the pre-commit checklist means to guard against. It would be a real inconsistency to introduce `next/image` in only one spot.

**Chaining a `dark:` variant with a responsive variant on one element (e.g. `lg:dark:block`) has unverified/ambiguous win-order against a sibling `dark:hidden` class in this project's Tailwind v4 setup** — avoid it. Prefer nesting: wrap theme-scoped content in an outer `dark:hidden` / `hidden dark:block` container first, then apply only the single remaining variant (e.g. `lg:block`) to elements inside it. Used for the collapsed-sidebar wordmark→glyph swap in `Sidebar.tsx`.

**Desktop-only, localStorage-persisted UI preferences must hide content via breakpoint-scoped CSS, not JS unmounting** — e.g. `collapsed && "lg:hidden"`, never `{!collapsed && ...}`. A stale `true` value restored from `localStorage` on a mobile device would otherwise unmount content that the mobile layout still needs, since the desktop preference has no business affecting a breakpoint it was never set at. Established with the sidebar collapse feature (`Sidebar.tsx` / `DashboardShell.tsx`, JFR-101) — apply the same rule to any future desktop-only persisted toggle.

---

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

Internal API for Claude Code to track work. Full docs in `CLAUDE_API.md`. **Create an issue at the start of every non-trivial task.**

- **Local:** `http://localhost:3000/api/v1` | **Production:** `https://taskforge-production-099b.up.railway.app/api/v1`
- **Always use the production URL for issue tracking** — creating issues and posting comments must go to production. Local dev issues are ephemeral and invisible in the real tracker. Use local only when testing the API itself.
- Auth: `X-Internal-Api-Key: <V1_API_KEY>` on every request. Never commit the key.
- Post comments as Maximus: `authorId: "cmo365psl000vdrd0p63lirlz"` — **production only**. Maximus does not exist in the local dev DB. For local v1 API calls that require an authorId, use Alice Chen — **look up her id, don't reuse a remembered one**: the seeded cuids differ between local DBs (the old `cmo37pswr…` id gave a bare `500` on `POST /api/v1/issues` on 2026-10-07; this DB had `cmshr2wjj000078vmirb53yfl`, via `psql … select id,email from "User"`).
- **The `mcp__claude_ai_JedForge__add_comment`/`create_issue`/`update_issue` connector tools cannot post as Maximus** — they authenticate via the JFR-100 OAuth flow bound to Jamie's own account, with no `authorId` override in their schema, so anything posted through them lands under Jamie Edmondson's name. For a Maximus-authored fix-summary comment, always call the production v1 REST API directly (Python `urllib`, see below) instead of the MCP tool.
- **`GET /api/v1/projects` returns `{ projects: [...] }`, not a plain array** — access the list as `data['projects']`, not `data` directly.
- **The v1 API cannot set an issue's parent** — `POST`/`PATCH /api/v1/issues` ignore `parentId` (checked 2026-10-02, JFR-167 breakdown). To parent children to an Epic, create them via v1 (so they're authored as Maximus) and then link with the `mcp__claude_ai_JedForge__set_issue_parent` connector tool, which only links and posts nothing under Jamie's name.
- `statusId` accepts a cuid, a human name (`"Done"`), or a category key (`"DONE"`) — all three forms work. **The JFR project's statuses are `Backlog`, `Ready`, `In Progress` and `Done`** (`Ready` appeared by 2026-10-07; it was absent on 2026-10-05) — there is no "Verification"/"In Review"; an unknown name returns a bare `400` with no message, so go straight to `Done` when the user says to close it. **"Next ready issue" is `GET /api/v1/issues?projectId=<JFR cuid>&status=Ready`** (status by name works, `projectId` is required alongside it); move it to `In Progress` when starting. JFR cuid: `cmouj659w0001pypck86hd56i`.
- `IssueStatus` enum is gone — use `ProjectStatus` rows. `IssuePriority`: `CRITICAL | HIGH | MEDIUM | LOW`. `IssueType`: `BUG | TASK | STORY | EPIC` (JFR-140, 2026-09-28) — `POST`/`PATCH /api/v1/issues` accept an optional `type` field, defaulting to `TASK`; before this fix, every API-created issue was silently hardcoded to `TASK` regardless of what was sent, with no `type` field even present in responses to notice.
- **`source .env` alone does not export vars to a `python3`/subprocess call** — bash `source` only sets shell variables, not environment variables, so `os.environ.get("V1_API_KEY")` comes back `None` even though the shell's own `$V1_API_KEY` looks fine. Use `set -a; source .env; set +a` first (or `export $(cat .env | xargs)`) before any Python/curl call that reads the key from the environment.
- **Use Python `urllib` for API calls whose JSON body contains backticks** — bash interprets backticks in curl `-d` strings as command substitution, causing the call to fail silently with a 500. `python3 -c "..."` double-quoted strings have the **same problem** — bash still expands backticks inside `"`. Use `python3 -c '...'` (single-quoted outer string, no literal single quotes in data) or a heredoc Python script (`python3 << 'PYEOF' ... PYEOF`) instead. **The heredoc delimiter must be quoted** — an unquoted `<< PYEOF` still expands backticks and `$(...)` in the body and *runs* them (it silently re-ran `npm test` and the integration suite once). For long PR/comment bodies, write the file with the Write tool rather than through a shell heredoc.
- **Issue creation is `POST /api/v1/issues` with `projectId` in the body** — there is no `/api/v1/projects/[key]/issues` route; using it returns 404. `projectId` must be the cuid, not the project key. Get the cuid from `GET /api/v1/projects` if you only know the key.
- **`GET` and `PATCH /api/v1/issues/[id]` accept the issue key** (e.g. `JFR-88`) as well as the cuid. Using a cuid for PATCH returns 404 — always use the key form (e.g. `JFR-88`) for single-issue operations.
- **Comments endpoint is `POST /api/v1/issues/[key]/comments`** — there is no `/api/v1/comments` route; posting to it returns 404. Body: `{ authorId, body }` (HTML string).
- **`GET /api/v1/issues?status=...` requires `projectId` in the same request** — omitting it returns `400 { "error": "projectId is required when filtering by status" }`, even though `status` alone is otherwise a documented, independent filter. `assigneeId` alone (no `status`, no `projectId`) works fine across all projects. To find a user's issues in a given status across projects, fetch by `assigneeId` only and filter the `status.name` client-side.

---

## Local dev environment (Windows / Jed's machine)

- **Local `.env` exists** — `/home/jamie/Projects/TaskForge/.env` is present and contains `V1_API_KEY`, `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`. If it ever goes missing, recreate from `.env.example` and re-add secrets from Railway.
- **Spurious file-mode-only diffs (`644`↔`755`) show up in `git status` with no content change** — seen on `package.json`, `vitest.config.ts`, and files under `src/components/ui/`, persisting across sessions with no one having touched them. Likely a WSL/Windows-mount artifact (NTFS doesn't preserve unix exec bits reliably). `git diff` on the affected file shows only `old mode`/`new mode` lines, no content. Safe to leave alone — don't restage or commit a mode flip unless you deliberately changed a file's executable bit.
- Docker Postgres on port 5433 — start with `docker start taskforge-db` if not running (see startup checklist above).
- Seeded test users (all password `password123`, actual domain per `prisma/seed.ts` is `@jedforge.dev`, not `@taskforge.dev` as earlier notes here said — corrected 2026-08-06): `admin@jedforge.dev` (Alice Chen, `UserRole.ADMIN` — use this account to test any admin-gated feature), `member@jedforge.dev`, `carol@jedforge.dev`, `dave@jedforge.dev`.
- **`npm run test:integration` leaves stray rows in the local dev DB** — the Users admin list shows extra `N` users with `…@itest.local` emails (e.g. `token-cap`, `ip-blocked`) and a `Sprint Test Project` (`SPT039`) beyond the seeded four users/three projects. Harmless residue from earlier suites (seen 2026-10-02); ignore them rather than treating them as seed data, and don't delete them while a test run may be using them.
- **`npm run lint` baseline is 39 warnings, 0 errors (2026-10-05)** — compare against that, not against zero. `react-hooks/set-state-in-effect` is the usual new-warning source: derive state at render instead (e.g. `useSyncExternalStore` with a server snapshot for a platform/`navigator` hint; store the answered query next to async results so "loading" is derived rather than set in the effect).
- **Browser-pane QA quirks (2026-10-05):** `computer` `screenshot` taken immediately after a `key`/Return often shows the *previous* frame (looked like Ctrl+K and "Create issue" had failed; they hadn't) — wait ~1s or read state with `javascript_tool`. `type` with `\t` doesn't move between fields and a trailing `\n` doesn't submit the login form: click each field, then click Sign in.
- **More browser-pane facts (2026-10-07):** (a) `computer` coordinates are in an **800x600 frame while the viewport is 1024x768**, so a DOM `getBoundingClientRect()` centre must be divided by **1.28** before clicking; get rects from `javascript_tool` rather than eyeballing a scaled screenshot, and re-measure after an error banner or toast shifts the layout (several clicks silently missed that way). (b) The pane often reports `document.visibilityState === "hidden"` and `document.hasFocus() === false` when the app isn't focused, so `autofocus` doesn't focus and visibility/focus-driven code (AutoRefresh) does nothing until you override `visibilityState` and dispatch the event. (c) In dev, streamed Suspense segments leave `<div hidden id="S:n">` copies in the DOM (the unmodified issues page too), so `querySelectorAll` doubles up — filter on `offsetParent !== null` before concluding something rendered twice. (d) `left_click_drag` works for dnd-kit pointer drags (backlog → sprint, board cards) and `key` Space/arrows drives its keyboard sensor. (e) The app **stops the `taskforge-dev` preview server when the session sits idle** (it ended after ~2 h) and the restarted tab has no session cookie — run `preview_start {name: "taskforge-dev"}` again and sign in as the seeded admin.
- **`preview_start {name}` fails with "Port 3000 is in use by another chat's dev server" when another session already runs `npm run dev` from this checkout (2026-10-06)** — that server hot-reloads your edits, so don't try to free the port; use `preview_start {url: "http://localhost:3000/..."}` instead and drive it as usual. Local `SPT039` (an `itest` residue project, admin is `PROJECT_LEAD`) is the only `SPRINT`-mode project, handy for backlog/sprint UI checks — delete any sprints you create there afterwards.
- **A stale dev server shows up as `Cannot read properties of undefined (reading 'findUnique')` on a new model (2026-10-07, JFR-183)** — and Next's error overlay adds a misleading "script tag" message. After `kill <pid>` the preview tool can keep reporting "Port 3000 is in use by another chat" for a few seconds even though `ss` shows it free; retry `preview_start {name: "taskforge-dev"}` rather than editing launch.json.
- **The local `.env` has a real `RESEND_API_KEY`, so mail-sending flows send for real from `npm run dev`** (a browser test of the forgot-password form emailed a made-up seeded address, 2026-10-07). Test such flows with addresses that don't exist, or fake `resend` as the integration suite does. See `email.md`.
- **After a schema change, restart the dev server — `npx prisma generate` alone isn't enough (2026-10-06, JFR-190)** — a running `next dev` keeps the Prisma client it loaded at startup, so a page that queries the new column errors with "Unknown field `…` for select statement on model …" even though `migrate deploy`, `tsc` and the tests all pass. If the server was started by another session, `preview_stop` can't stop it: with the user's OK, `kill <pid>` (`ss -ltnp | grep :3000`), wait for the port to free, then `preview_start {name: "taskforge-dev"}`.
- **Dev-server CSS can go stale (2026-10-06, JFR-191)** — after editing `globals.css`, `next dev` kept serving the old compiled stylesheet (same chunk hash and byte length, even after a restart). `rm -rf .next/dev/cache` and restart fixed it. The rebuild re-fetches Google Fonts, which can fail transiently (`Can't resolve '@vercel/turbopack-next/internal/font/google/font'`, a 500 on every page) — the same error that once failed `Verify` on `main` CI; clear the cache and restart again, or re-run the CI job.
- **Testing a role-gated or empty-org view locally (2026-10-07, JFR-186)** — the seeded org is fully populated, so first-run UI is hidden for `admin@jedforge.dev`. Insert throwaway rows by SQL and delete them after: `User` needs `id,name,email,"passwordHash","updatedAt"` (copy Alice's hash via `insert … select`, password `password123`), `Organization` needs `id,name,slug,"ownerId","updatedAt"`, plus an `OrgMember` row (`gen_random_uuid()::text` id). Use `…@itest.local` emails. Switch the browser-pane session with `fetch('/api/auth/csrf')` then `POST /api/auth/signout` (`csrfToken`, `json=true`) and sign in at `/login`; after a navigation `form_input`/`computer` refs need a fresh `read_page` first.
- **The React-compiler lint turns `ref.current = …` inside a handler that is passed to child components into an *error* (2026-10-07, JFR-185)** — it also re-flagged the sibling handlers in the same component. Keep cross-render bookkeeping such as the board's "last local write" clock in a module-level helper (`src/lib/board-activity.ts`: `markBoardWrite`/`msSinceBoardWrite`) rather than a `useRef`.
- Seeded local projects (keys): `PL` (Product Launch), `MA` (Mobile App), `WR` (Website Redesign). `prisma/seed.ts` does **not** create a local `JFR` project (corrected 2026-08-06 — earlier notes here were wrong). Production has additional projects (`JFR`, `TFEN`, `JFDOCS`, `WEQUIZ`, etc.) that do not exist in local dev.
- **After a Prisma schema change, restart the dev server before browser-testing (2026-10-06, JFR-188)** — a running `next dev` keeps the old generated client in memory, so any query touching a new column throws and the UI just shows its generic load-failure toast. Next also refuses a second `next dev` in the same directory, even with `autoPort: true` (it reports the existing PID), so the only fix is to stop the running one (ask first if another session owns it) and `preview_start` again. Seeding a `CustomField` by raw SQL needs casts: `'NUMBER'::"CustomFieldType"` and `'{}'::text[]` for `options`, plus `"updatedAt"`.
- **`.claude/launch.json` is tracked in git** (despite living under `.claude/`). To run the preview dev server with extra env (e.g. `ALERTING_ENABLED=true` + a fake `RESEND_API_KEY`), add a temporary config using `"runtimeExecutable": "env"` with `runtimeArgs: ["VAR=value", ..., "npm", "run", "dev"]`, then `git checkout .claude/launch.json` before committing — a leftover edit shows up as ` M` in `git status`. The preview browser is already signed in as the seeded admin (`admin@jedforge.dev`) on localhost.
- Production URL: `https://www.jedforge.com` (also accessible at `https://taskforge-production-099b.up.railway.app`).
- **`prisma/seed.ts` deletes ALL users/orgs/projects and is now guarded (SECH-110)** — it refuses any non-localhost `DATABASE_URL` unless `SEED_ALLOW_REMOTE` equals that exact host and `SEED_PASSWORD` is 16+ chars (`prisma/seed-guard.ts`). Local runs are unchanged (`password123`). Staging provisioning, deploy and smoke-check recipe: `.context-docs/local-dev-tooling.md` → "Staging environment".
- **Stray untracked files sit in the repo root/scripts from a prior session** (`instructions.txt`, `JedForge-Timeline.docx`, `Jedforge docs module UI mockups.zip`, `design_handoff_docs_module/`, `jedforge_icons_light_dark/` (incl. `logo-dark.png`/`logo-light.png`), `jedforge-ui-mockups.html`, `scripts/generate-timeline.mjs`) — untracked design-handoff/mockup leftovers (the oldest date from 2026-09-08), unrelated to the SECH/JFR work in progress. Not part of any in-progress task; leave them alone rather than re-investigating, unless Jamie asks about them directly.
- **Two Railway GraphQL queries are blocked by the auto-mode classifier as credential fetches** (corrected 2026-09-23 — the DB one used to work): the **log stream** (`environmentLogs`), and **`variables(projectId, environmentId, serviceId)`**, which was the way to get `DATABASE_PUBLIC_URL` for direct production DB access. Both use the `RAILWAY_API_TOKEN` from `~/.bashrc`. Don't retry or work around them — ask Jamie to run the query or check the Railway dashboard UI (e.g. for `[csp-report]` log lines, SECH-84).
- **The auto-mode classifier also blocks writes to secret stores, even when Jamie approves in chat (2026-10-01, SECH-113)** — `gh secret set`, rewriting `V1_API_KEY` in `.env`, and even a `gh secret list` bundled into a command were all denied as "Secret-Store Writes", and the denial extends to cleanup in the same command. Don't retry or split the command; prepare the runbook and hand the rotation to Jamie (steps in `.context-docs/secret-rotation.md`), or ask him to add a Bash permission rule. Plain `gh pr merge`/`gh run list`/`curl` are fine.
- **`SetPageTitle` breadcrumbs only resolve on client-side navigation, not on a hard load** — `PageTitleProvider`'s `pathname` effect runs after the page's own `SetPageTitle` effect and clears it, so a directly loaded `/admin/orgs/<id>` or `/admin/users/<id>` shows the raw cuid as the last crumb (verified 2026-10-02: clicking in from the list shows the name). Pre-existing, unfixed; don't chase it per page.
- **The `deployments(...)` status query still works** and is the way to confirm a push reached production. It is also sufficient evidence that a **migration applied**: `railway.toml` sets `preDeployCommand = "npx prisma migrate deploy"`, so a failed migration fails the deploy instead of swapping in new code — a deployment whose `meta.commitHash` matches your commit with `status: SUCCESS` means the migration ran. **It returned a plain `"Not Authorized"` GraphQL error once (2026-09-28, JFR-154 verification) but worked again on 2026-09-30 (SECH-117 deploy, ~immediate `SUCCESS` for the merge commit)** — same token, with the browser-like `User-Agent` header; treat the 09-28 failure as transient, so retry before falling back to asking Jamie. It worked again 2026-10-01 (JFR-165/166 deploy): poll `deployments(...)` every ~20s and expect `BUILDING` → `DEPLOYING` → `SUCCESS` in about 3 minutes, with the previous deployment flipping to `REMOVED` — the `meta.commitHash` match plus `SUCCESS` is the confirmation. Read the token with `grep -oP 'RAILWAY_API_TOKEN=\K[^ "\']+' ~/.bashrc` and send the browser-like `User-Agent`. **Parse it with `\s` excluded (`[^\s"']+`), not `[^ "']+`** — the latter swallows the trailing newline/comment, the header is rejected, and Python's traceback then echoes the full token into the transcript (happened 2026-10-02). Put the query in a scratchpad `.py` file rather than a `VAR=… python3 <<` one-liner, whose nested quotes break the shell.

See `.context-docs/local-dev-tooling.md` for the Railway CLI/GraphQL API workarounds, seeded-user org-membership nuance, Playwright setup and gotchas, icon/logo asset crop details, psql/execSync quoting, and following a session from the iPhone via Remote Control.

---

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

- **Never pass client-supplied objects straight into a Prisma `data:` (mass assignment) — copy an explicit field whitelist.** Server Action arguments and JSON bodies are attacker-controlled at runtime whatever their TypeScript type says; `data: { ...updates }` / `data: input` let a low-privilege editor set `projectId`, `orgId`, `userId`, `isPrivate`… (SECH-85 fixed this in `updateIssue`, `updateProject`, `updateFilter`). Likewise any client-supplied id (`statusId`, `parentId`, `sectionId`, `orgId`…) must be verified to belong to the caller's project/org (`findFirst({ where: { id, projectId } })`) — a guard on `projectKey` says nothing about the ids passed alongside it. Full route/action inventory: `.context-docs/authz-matrix.md`.

- **Use the shared guards in `src/lib/permissions.ts`, don't re-implement them** — `requireAdmin()` is the only admin guard (the admin-actions local copy was removed, SECH-96); callers holding a project cuid instead of a key use `requireProjectRoleById(projectId, check)`, which shares `requireProjectRole`'s private/closed/membership/grants path. Role gates for edit-type writes should be `canEditIssues(role, grants)`, never a hard-coded `["PROJECT_LEAD","TEAM_MEMBER"]` list, or group grants silently stop applying.

- **AI Chat is Jamie-exclusive, never for a buyer/other entity** — gated behind `AI_CHAT_ENABLED` (`src/lib/ai/feature-flag.ts`), checked server-side in both `/api/ai/*` routes (404 when off, not 403 — a disabled instance shouldn't reveal the routes exist) and in the issue detail page before rendering `AiChatPanel`. Defaults to unset/`false`; only Jamie's own deployment sets it `true`. If the product is ever sold or transferred, the buyer's environment must not have this var set.
- **Security headers + CSP are set in `next.config.mjs` `headers()` (SECH-84)** — nosniff, Referrer-Policy, Permissions-Policy, `X-Frame-Options: SAMEORIGIN` are enforced; HSTS is production-builds-only; the CSP ships as **`Content-Security-Policy-Report-Only`** (violations POST to `/api/csp-report`, logged as `[csp-report]` with query strings scrubbed) — it is NOT yet enforcing. Every allowed source in `buildCsp()` has a documented reason and `security-headers.test.ts` pins the exact lists, so **adding a new external image/frame/connect source means editing both**. Only external origin today: `https://*.storageapi.dev` (Railway bucket; `img-src` + `frame-src` for the PDF preview iframe) — all browser uploads/fetches are same-origin. Moving to enforcing = rename the header key after reviewing prod `[csp-report]` logs; `script-src` still needs `'unsafe-inline'` (Next's hydration scripts) until a per-request nonce is wired through middleware. Local verification: `curl -sI localhost:3000/login`, and `new Image().src = "https://example.com/x.png"` in the console should log a `[csp-report]` line.
- **Uploads are raster-only and downloads are never inline by default (SECH-125)** — image uploads (attachments, editor images, avatar) must pass `validateRasterImage()` / `sniffRasterFormat()` from `src/lib/upload-validation.ts` (magic bytes *before* sharp, and the format must match the declared type). "sharp decodes it" is **not** a safety check: sharp decodes SVG, and SVG can carry `<script>`. Every `getPresignedDownloadUrl()` call must pass `{ contentType, fileName }`. Only raster images and PDF are signed `inline` with a pinned type (`src/lib/download-headers.ts`); everything else, including legacy SVGs already stored, downloads as `application/octet-stream`. A new previewable type means adding it to `INLINE_SAFE_TYPES` deliberately.
- **Dependency audit gate (SECH-104)** — the `Dependency audit` CI job runs `scripts/audit-gate.mjs`, which fails on **high/critical advisories in the production tree** (`npm audit --omit=dev`) unless the advisory is mirrored in `.security/audit-allowlist.json` with a `riskId` and an `expires` date. Moderates never block a merge. **A newly published advisory turns every open PR red with no change of yours** (GHSA-6qxp-vccf-f47h on `@modelcontextprotocol/sdk`, 2026-10-07): fix it in its own PR branched from `origin/main` (bump the range in `package.json`, `npm install`, run `node scripts/audit-gate.mjs` locally), merge it, then `git merge origin/main` into the blocked branch — don't bundle the bump into a feature PR. `npm ls <pkg>` shows if a dev tool like `shadcn` shares the copy. An acceptance that expires while its advisory is still present turns CI red again — renew the risk-register decision or fix the dependency, don't just push the date out. The gate is deliberately dependency-free and runs **without `npm ci`** (`npm audit` resolves from the lockfile alone), so don't add an install step to it. A weekly `dependency-audit.yml` covers dev deps too and keeps the report + CycloneDX SBOM as artifacts. Schema and rules: `.security/README.md`.

- **Secret scanning (SECH-112)** — the required `Secret scan` CI job runs gitleaks over the full history of every ref, so any secret committed on any branch fails every later PR. Don't allowlist a real credential in `.gitleaks.toml`; rotate it (history in a public repo can't be un-leaked). **Run the local scan before pushing test fixtures that contain passwords/tokens** — fake ones were flagged as `generic-api-key` (JFR-183), and since history is scanned the fix is amending the commit and `--force-with-lease` on your own branch, not a new commit (recipe + the entropy threshold: `secret-scanning.md`). `.env` was committed in early history (dev values only) — never reuse the local `AUTH_SECRET` anywhere. See `.context-docs/secret-scanning.md`.
- **Application code never calls `console.*` — use `logError(context, error)` (SECH-115)** — from `src/lib/security-events.ts`; `src/__tests__/console-sinks.test.ts` enforces it with a reasoned allowlist (the emitter, the instrumentation patch, alerting's own failure line, and four client components). **Never pass a raw error to a console method**: `PrismaClientValidationError.message` embeds the whole failed `data:` object, which is how document content reached production logs. Prisma uses event-based error logging in production and `console` is patched in `src/instrumentation.ts` (production only, and it must wrap `console.log` too — Prisma logs through `log`, not `error`). Adding a sensitive key to `SENSITIVE_KEYS` means checking it does not collide with a diagnostic field — bare `code` is excluded because it collides with Prisma's `P2002`. Details: `.context-docs/log-redaction.md`.

- **`securityEvent()` is the only security-log sink (SECH-114)** — `src/lib/security-events.ts`. Severity is keyed by event type in the catalog, never passed by a call site, and caller data is nested under `meta` so it cannot clobber `type`/`severity`. `security-logging-sinks.test.ts` fails on a `console.warn` security signal; `security-event-wiring.test.ts` fails if a catalog type has no real call site. Adding a type means updating the union, `SECURITY_EVENT_SEVERITY`, the pinned list in `security-events.test.ts`, and wiring a call site. Middleware sets `x-request-id` on every request and response; `/api/auth` is outside the matcher, so `securityEvent()` generates one when absent. Denial classification (which denials are deliberately silent) and the rest: `.context-docs/security-events.md`.

- **v1 API requires shared secret** — every request to `/api/v1/...` must include `X-Internal-Api-Key: <V1_API_KEY>`. The guard is in `src/lib/v1-auth.ts` (constant-time comparison). Set `V1_API_KEY` in Railway environment variables and in local `.env`. Never commit the actual value.
- **Avatar GET requires authentication** — `GET /api/avatar` returns 401 without a valid session. The PUT handler was already protected; the GET was added in the same security pass.
- **TipTap HTML is sanitized server-side** — all write paths that persist issue descriptions, comment bodies, and doc page content call `sanitizeTipTapHtml()` from `src/lib/sanitize-html.ts` (backed by `isomorphic-dompurify`) before the Prisma call. The viewer component (`rich-text-display.tsx`) does not sanitize — it relies on content already being clean in the database. **`ALLOWED_TAGS` must cover everything `getHTML()` emits**, or the difference is silently destroyed on save — `label` was missing until SECH-124, so task-list checkboxes lost their wrapper on every write. `rich-text-extensions.test.ts` now asserts `sanitizeTipTapHtml(getHTML(...)) === getHTML(...)`; run it after any editor-extension or allowlist change.
- **Owner alerting never emits security events (SECH-117)** — no file under `src/lib/alerting/` may import `security-events`: `app.error`/`prisma.error` feed the `error_spike` rule, so an alerting failure that emitted one would feed itself. Failures go through `alertingFailure()`. It also must **not use the shared `@/lib/prisma` client**: that client's `$on("error")` emits `prisma.error` for every failed query, so an alerting query failing would re-enter `observe()` in a loop — `store.ts` owns its own `alertingDb`, and `alerting-store.itest.ts` proves it. Off unless `ALERTING_ENABLED` is exactly `"true"`. Details: `.context-docs/alerting.md`. **Live in production since 2026-10-01** (`ALERTING_ENABLED` + `ALERT_EMAIL_TO` set in Railway after the drill showed neither had ever been; before that nothing could be emailed). The six drill emails (`[DRILL]`, one per rule) reached the inbox; the site-down monitor (7th alert) is not set up.
- **Comment edit/delete requires current membership** — `updateComment` and `deleteComment` in `src/app/(dashboard)/projects/[projectKey]/actions.ts` call `requireProjectMember(projectKey)` before the author check. A cross-project guard (`comment.issue.projectId !== projectId`) also returns "Comment not found" if the comment belongs to a different project than the key in the URL.
- **Attachment delete requires current membership** — `DELETE /api/attachments/[id]/route.ts` gates both the uploader and `PROJECT_LEAD` paths on `!!member`, so a former member cannot delete their own uploaded files.
- **Session invalidation via `sessionVersion`** — `User.sessionVersion` (Int, default 1) is a monotonically increasing counter. The jwt callback in `src/lib/auth.ts` fetches the current DB value on every `auth()` call and sets `token.invalidated = true` if the versions differ. `getCurrentUser()` returns `null` for invalidated tokens, so all `requireAuth`/`requireAdmin`/page-layout guards see the user as logged out on their next request. Three events bump the counter: `adminResetUserPassword`, `adminUpdateUser` (role changes only), and `changePassword`. After a self-service password change, the client calls `session.update()` which triggers `trigger === "update"` in the jwt callback — this re-arms the active session's token by syncing its version forward, keeping the password-changing browser logged in while all other sessions are invalidated. **Enforcement (SECH-86, 2026-09-21):** `auth()` exported from `src/lib/auth.ts` is now fail-closed — it returns `null` for an invalidated session, so every API route / Server Action / `permissions.ts` helper rejects it with no per-site change. Server Component pages and layouts use `requireUser()` (redirects), which sends invalidated sessions to `/api/session-invalidated` (clears the cookie, then `/login`) rather than straight to `/login`. Invalidation is still NOT checked in Edge middleware (`auth.config.ts`, no Prisma), so middleware sees the stale JWT as logged in and bounces `/login` → `/` — redirecting an invalidated session to plain `/login` would loop forever. Never call the raw NextAuth session directly (`authUnchecked()` is reserved for `auth.ts` and that route; a test enforces this). New dashboard `page.tsx`/`layout.tsx` files must call `await requireUser()` (`session-invalidation.test.ts` fails otherwise). See `.context-docs/middleware-patterns.md` #8. **Credential revocation beyond web sessions (SECH-94, 2026-09-22):** OAuth access/refresh tokens and org API keys are opaque bearer strings with no captured `sessionVersion` to check live, so they're revoked push-style at the same trigger points instead — `src/lib/credential-revocation.ts` (`revokeOAuthTokensForUser`, `revokeApiKeysForUser`), called from `changePassword`, `adminResetUserPassword`, `adminUpdateUser` (role-change branch only), and `adminRemoveOrgMember` (org-scoped). There is still no action to change an existing `OrgMember.role` in place (only create/delete), so that trigger doesn't exist yet — don't assume API keys get revoked on an org-role change, only on removal.

---

## Reference docs (load when relevant)

- .context-docs/shortcuts.md — global/project/issue keyboard shortcuts, the `?` help overlay and shared registry `src/lib/shortcuts.ts` (JFR-177 — new shortcuts must be added there), and the Cmd/Ctrl+K command palette (JFR-176: `CommandPalette`, `paletteSearch` gated on `getCurrentUser()` + member/non-closed scope, `jedforge:open-palette` / `jedforge:create-issue` events)
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
- .context-docs/shortcuts.md — global and project-context keyboard shortcuts
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
- .context-docs/ai-chat.md — AI Chat panel (JFR-111/112): production-only testing, MCP SDK content-block shapes, internal token minting
