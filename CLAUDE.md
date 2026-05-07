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

The Prisma CLI is not available in the bash sandbox. To add columns:
- Connect using the `DATABASE_PUBLIC_URL` from `railway variables --service Postgres`.
- Run raw SQL via a `node -e` script using `@prisma/client` with the public URL, or psycopg2 if available.
- Example: `ALTER TABLE "Issue" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);`
- Also update `prisma/schema.prisma` to keep it in sync (Prisma will pick up the column on next query generation).

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

## Roadmap tracking

All planned improvements are tracked as issues in the **JFR** project (JedForge Roadmap) at jedforge.com. When implementing a roadmap item:
1. Look up the JFR issue for full context before starting.
2. Set the JFR issue status to "In Progress" when work begins.
3. Add a comment to the JFR issue documenting what was shipped.
4. Set status to "Done" when deployed and verified.
