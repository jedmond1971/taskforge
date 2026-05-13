# TaskForge / JedForge — Codebase Notes

## Organization tenancy invariants

Every project belongs to exactly one organization, and every user-to-project relationship must be valid inside that organization. This is a core product invariant — JedForge is a multi-tenant product where each client organization experiences the app as its own instance.

**Rules enforced in code:**

1. **Registration** (`src/app/api/auth/register/route.ts`) — Creating a `User` also creates a default `Organization` and an OWNER `OrgMember` in the same transaction. A registered user must always have an org before they can sign in and create projects.

2. **Project member search** (`searchUsers`) — Only returns users who are `OrgMember`s of the project's org and are not already project members. Users from other orgs are never surfaced.

3. **Adding a project member** (`addProjectMember`) — Validates that the target user has an `OrgMember` row for the project's org before creating the `ProjectMember`.

4. **Creating a user from project settings** (`createUserAndAddToProject`) — Creates `User`, `OrgMember` (for the project's org), and `ProjectMember` in one transaction.

5. **Issue assignees** (`createIssue`, `updateIssue`) — If `assigneeId` is non-null, the assignee must have a `ProjectMember` row for the same project. Null/unassigned is always allowed.

6. **Admin org deletion** (`adminDeleteOrg`) — Blocked with a clear error if the org has any projects. Does not cascade-delete projects silently.

7. **Admin org-member removal** (`adminRemoveOrgMember`) — Blocked with a clear error if the user still has `ProjectMember` rows for any project in that org. Employment/org-access changes must not erase project history; another admin or project member must intentionally remove those project memberships first. Do not cascade-delete or silently clean up project memberships from org-member removal.

**Non-goals (do not implement without a separate product decision):**
- Org switching UI
- Full invite system
- Billing/subscription changes
- Broad project membership role redesign
- Cascading project deletion on org delete

---

## UI component library

This project uses **`@base-ui/react`** (NOT Radix UI). Standard shadcn components that depend on Radix (e.g. AlertDialog) do not exist here. Custom equivalents are built on Base UI primitives.

- `src/components/ui/confirm-dialog.tsx` — reusable confirmation dialog (wraps Base UI Dialog). Use this for all destructive action confirmations instead of `window.confirm()`.
- `src/components/ui/rich-text-editor.tsx` — TipTap v2 editor with toolbar (bold, italic, strike, H2/H3, bullet/numbered/task lists, code, blockquote, link, HR).
- `src/components/ui/rich-text-display.tsx` — read-only HTML renderer for TipTap content. Handles plain-text fallback gracefully.

---

## Rich text (TipTap)

Issue descriptions and comment bodies are stored as **HTML strings** in the database (the existing `String` fields handle this without schema changes).

- Empty editor state is normalized to `""` (not `"<p></p>"`), so existing `|| null` / `|| undefined` checks continue to work.
- Existing plain-text content is rendered correctly by `RichTextDisplay` via a `toSafeHtml()` fallback that wraps non-HTML strings in `<p>` tags.
- ProseMirror + prose styles are in `src/app/globals.css` under the `/* Rich text editor */` comment block.
- TipTap packages: `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/extension-placeholder`.

---

## Adding npm packages

The bash sandbox cannot access `P:\TaskForge`, so `npm install` cannot be run from within a Cowork session. To add packages:
1. Edit `package.json` manually (add to `dependencies`).
2. Ask Jamie to run `npm install` locally — this updates `package-lock.json`.
3. Commit both files and push. Railway uses `npm ci` which requires the lockfile to be in sync.

---

## Database migrations

`psql` is available locally and is the most reliable way to apply migrations to production:
```bash
psql "$(railway variables --service Postgres --json | python3 -c "import sys,json; print(json.load(sys.stdin)['DATABASE_PUBLIC_URL'])")" -f prisma/migrations/<name>/migration.sql
```

For local dev (Docker Postgres on port 5433): `npx prisma migrate dev`

Always write the migration SQL file manually into `prisma/migrations/<timestamp_name>/migration.sql` and update `prisma/schema.prisma` in the same commit. Run `npx prisma generate` after schema changes to regenerate the Prisma client types (does not require a DB connection).

---

## Keyboard shortcuts

Global shortcuts registered in `DashboardShell`:
- `/` — navigate to `/search` (or focus the QueryBar if already there, via `jedforge:focus-search` custom event)

Project-context shortcuts registered via `ProjectShortcuts` (injected into the project layout):
- `N` — open CreateIssueDialog for the current project

Both shortcuts are suppressed when focus is inside an `INPUT`, `TEXTAREA`, or a `contenteditable` element.

---

## Avatar upload

User avatars are uploaded to Railway S3 under the key `avatars/{userId}.jpg` and served through the proxy route `/api/avatar?key=avatars/{userId}.jpg`, which redirects to a fresh presigned S3 download URL (1-hour browser cache). The full proxy URL is stored in `User.avatarUrl`. After upload the client calls `useSession().update({ image: url })` to refresh the session token immediately without requiring sign-out.

---

## In-app notifications

Notifications are stored in the `Notification` table and created via `src/lib/notifications.ts`. The service is the only place notifications should be written — do not insert directly.

**Trigger points** (all fire-and-forget, never throw):
- `createIssue` / `updateIssue` in `src/app/(dashboard)/projects/[projectKey]/actions.ts` — assignment and status changes
- `PATCH /api/issues/[issueId]` in `src/app/api/issues/[issueId]/route.ts` — same two events via the REST path
- `addComment` in the same actions file — notifies assignee and reporter

**Known gaps to wire up when touched:**
- `moveIssue` (drag-and-drop board) does not fire status-change notifications
- @mention notifications: `notificationService.mention()` exists but is never called — wire it in `addComment` once a TipTap mention extension is added

**UI entry points:**
- `src/components/notifications/NotificationBell.tsx` — bell icon in the header, fetches unread count on mount
- `src/components/notifications/NotificationDropdown.tsx` — 10 most recent, fetched on dropdown open
- `src/app/(dashboard)/notifications/page.tsx` — full list at `/notifications`

**Reading notifications** — use the server actions in `src/app/(dashboard)/notifications/actions.ts`: `getNotifications`, `getUnreadCount`, `markNotificationRead`, `markAllNotificationsRead`.

**No real-time push** — notifications appear on next page load or dropdown open. SSE delivery is a separate planned feature.

---

## Roadmap tracking

All planned improvements are tracked as issues in the **JFR** project (JedForge Roadmap) at jedforge.com. When implementing a roadmap item:
1. Look up the JFR issue for full context before starting.
2. Set the JFR issue status to "In Progress" when work begins.
3. Add a comment to the JFR issue documenting what was shipped.
4. Set status to "Done" when deployed and verified.
