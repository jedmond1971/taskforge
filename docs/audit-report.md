# JedForge Codebase Audit Report
Generated: 2026-05-13
Spec Version: v1.0 (file) / v1.2 (internal document header)

---

## Summary

The JedForge codebase is a well-structured Next.js 14 App Router application with a clean Prisma schema and solid multi-tenant tenancy enforcement. Of the eleven features marked "Built" in Section 4 of the spec, nine are fully confirmed in code, one (File Attachments) is now also fully built despite still being marked "Planned" in the spec, and one (In-App Notifications) has no implementation at all. The codebase has significantly outpaced the spec in several areas — most notably file attachments, the admin panel, organisation/subscription infrastructure, and a custom query-language search engine — none of which appear in the spec. The spec's data model (Section 10) diverges substantially from the actual Prisma schema: the spec describes Workspace, Status, Milestone, and Sprint models that do not exist, while the schema includes Organization, OrgMember, OrgInvite, Board, Column, SavedFilter, and Subscription models the spec does not mention. GitHub OAuth is listed as "Built" in the spec but is not present in the auth implementation.

---

## Phase 1 — Codebase Inventory

### Prisma Models (`prisma/schema.prisma`)

| Model | Key Fields |
|---|---|
| User | id, name, email, passwordHash, avatarUrl, role (UserRole: ADMIN/MEMBER), createdAt, updatedAt |
| Organization | id, name, slug, plan (Plan enum), ownerId, createdAt, updatedAt |
| OrgMember | id, orgId, userId, role (OrgRole: OWNER/ADMIN/MEMBER), createdAt |
| OrgInvite | id, orgId, email, token, role, accepted, expiresAt, createdAt |
| Subscription | id, orgId, stripeCustomerId, stripeSubscriptionId, stripePriceId, status (SubscriptionStatus), currentPeriodEnd, cancelAtPeriodEnd |
| Project | id, name, key, description, orgId, createdAt, updatedAt |
| ProjectMember | id, userId, projectId, role (ProjectMemberRole: OWNER/ADMIN/MEMBER/VIEWER) |
| Issue | id, projectId, key, title, description, status (IssueStatus enum), priority (IssuePriority enum), type (IssueType enum), assigneeId, reporterId, parentId, position, labels (String[]), dueDate, createdAt, updatedAt |
| Board | id, projectId, name |
| Column | id, boardId, name, position, color |
| Comment | id, issueId, authorId, body, createdAt, updatedAt |
| SavedFilter | id, name, query, userId, isGlobal, createdAt |
| ActivityLog | id, issueId, userId, action, field, oldValue, newValue, createdAt |
| Attachment | id, issueId, uploaderId, fileName, fileKey, fileSize, mimeType, createdAt |

**Enums defined:** UserRole, OrgRole, Plan, SubscriptionStatus, ProjectMemberRole, IssueStatus, IssuePriority, IssueType

### API Route Files and HTTP Methods

| Route File | Methods |
|---|---|
| `src/app/api/attachments/route.ts` | GET (list attachments for an issue) |
| `src/app/api/attachments/[id]/route.ts` | DELETE (delete attachment + S3 object) |
| `src/app/api/attachments/[id]/url/route.ts` | GET (fresh presigned download URL) |
| `src/app/api/attachments/confirm/route.ts` | POST (confirm upload, log activity) |
| `src/app/api/attachments/presign/route.ts` | POST (generate S3 presigned upload URL) |
| `src/app/api/attachments/upload/route.ts` | POST (server-side multipart upload to S3) |
| `src/app/api/auth/[...nextauth]/route.ts` | (NextAuth catch-all — GET, POST) |
| `src/app/api/auth/register/route.ts` | POST (create user + org + org member in transaction) |
| `src/app/api/avatar/route.ts` | PUT (upload avatar), GET (presigned redirect proxy) |
| `src/app/api/issues/[issueId]/route.ts` | PATCH (update issue fields), DELETE (delete issue) |
| `src/app/api/projects/route.ts` | POST (create project) |

**Note:** The majority of data mutations are handled via Next.js Server Actions in `src/app/(dashboard)/projects/[projectKey]/actions.ts` and `src/app/(dashboard)/admin/actions.ts` rather than REST API routes.

### App Route Segments (pages)

| Route | Purpose |
|---|---|
| `/(auth)/login` | Login page |
| `/(auth)/register` | Registration page |
| `/(dashboard)/` | Dashboard home (assigned issues, activity, due soon) |
| `/(dashboard)/projects` | Project list |
| `/(dashboard)/projects/[projectKey]` | Project root (redirects to board) |
| `/(dashboard)/projects/[projectKey]/board` | Kanban board |
| `/(dashboard)/projects/[projectKey]/issues` | Issue list/table view |
| `/(dashboard)/projects/[projectKey]/issues/[issueKey]` | Issue detail |
| `/(dashboard)/projects/[projectKey]/activity` | Project activity feed |
| `/(dashboard)/projects/[projectKey]/settings` | Project settings (general, members, danger zone) |
| `/(dashboard)/search` | Global search with query language |
| `/(dashboard)/settings` | User settings (avatar, password) |
| `/(dashboard)/admin` | Admin dashboard |
| `/(dashboard)/admin/users` | Admin: user management |
| `/(dashboard)/admin/projects` | Admin: project management |
| `/(dashboard)/admin/orgs` | Admin: organisation management |

### Components by Subdirectory

| Directory | Files |
|---|---|
| `components/activity/` | ActivityFeed.tsx |
| `components/attachments/` | AttachmentsPanel.tsx |
| `components/board/` | KanbanBoard.tsx, KanbanCard.tsx, KanbanColumn.tsx |
| `components/comments/` | CommentForm.tsx, CommentThread.tsx |
| `components/issues/` | CreateIssueDialog.tsx, IssueDetail.tsx, IssueFiltersBar.tsx, IssueForm.tsx, IssueList.tsx, LabelInput.tsx, PriorityBadge.tsx, StatusBadge.tsx |
| `components/layout/` | AutoRefresh.tsx, DashboardShell.tsx, Header.tsx, Sidebar.tsx |
| `components/projects/` | NewProjectDialog.tsx, ProjectNav.tsx, ProjectShortcuts.tsx |
| `components/providers/` | session-provider.tsx |
| `components/query/` | QueryBar.tsx, QueryResults.tsx, SavedFilters.tsx |
| `components/settings/` | AvatarUpload.tsx |
| `components/theme/` | ThemeToggle.tsx |
| `components/ui/` | avatar.tsx, badge.tsx, button.tsx, card.tsx, confirm-dialog.tsx, dialog.tsx, dropdown-menu.tsx, input.tsx, rich-text-display.tsx, rich-text-editor.tsx, separator.tsx, skeleton.tsx |

### Library Files (`src/lib/`)

| File | Purpose |
|---|---|
| `auth.config.ts` | Edge-safe NextAuth config (JWT strategy, trustHost, pages, base callbacks) |
| `auth.ts` | Full NextAuth config with Credentials provider and Prisma lookups |
| `issue-keys.ts` | Issue key generation with retry logic |
| `issue-utils.ts` | Status/priority/type config maps (labels, colours, icons) |
| `permissions.ts` | Role-based permission helpers and `requireProjectRole` / `requireAdmin` |
| `prisma.ts` | Prisma client singleton |
| `s3.ts` | Railway S3 helpers: presigned upload/download URLs, putObject, deleteObject |
| `utils.ts` | Tailwind `cn()` utility |
| `query/parser.ts` | Custom query language tokeniser/parser (JQL-like syntax) |
| `query/validator.ts` | Query AST validation |
| `query/executor.ts` | Prisma WHERE clause builder from query AST |
| `query/index.ts` | Re-exports for query subsystem |

### Auth Protection Patterns

- `src/middleware.ts`: Runs on all non-static routes. Redirects unauthenticated users to `/login`. Auth routes redirect authenticated users to `/`. The `/api/auth/register` route is explicitly public; all other API routes pass through without JWT check (API routes rely on per-handler `auth()` calls).
- `src/app/layout.tsx`: Wraps the app in `ThemeProvider` + `SessionProvider`.
- Project-level: `requireProjectRole()` in `src/lib/permissions.ts` is called by all server actions to check membership and role. `requireAdmin()` checks `session.user.role === "ADMIN"`.

---

## Phase 2 — Feature Audit (Section 4 of Spec)

| # | Feature | Status | Evidence |
|---|---|---|---|
| 1 | **Projects (create, archive, delete)** | ⚠️ Partial | Create: `POST /api/projects/route.ts`. Delete: `deleteProject()` server action. **Archive is not implemented** — no `isArchived`/`status` field on `Project` model, no archive action, no UI. |
| 2 | **Issues / Tickets (create, assign, status, priority, close)** | ✅ Confirmed | `createIssue`, `updateIssue`, `deleteIssue` server actions. Full PATCH at `/api/issues/[issueId]`. `IssueDetail`, `IssueList`, `CreateIssueDialog` components. All status/priority/assignee operations confirmed. |
| 3 | **Subtasks** | ✅ Confirmed | `Issue.parentId` FK in schema. `getIssue` returns `parent` and `children`. `IssueDetail` renders Sub-Issues panel with add/list. `CreateIssueDialog` accepts `parentId` prop. |
| 4 | **Comments on issues** | ✅ Confirmed | `Comment` model in schema. `addComment`, `updateComment`, `deleteComment` server actions. `CommentThread` and `CommentForm` components. |
| 5 | **Labels / Tags** | ✅ Confirmed | `Issue.labels String[]` field in schema. `LabelInput` component. Filter support in `getIssues`. Query language supports `labels` field. |
| 6 | **Kanban board view** | ✅ Confirmed | `KanbanBoard`, `KanbanColumn`, `KanbanCard` components using `@dnd-kit`. `moveIssue` and `reorderIssues` server actions. Board page at `/projects/[projectKey]/board`. |
| 7 | **List / Table view** | ✅ Confirmed | `IssueList` component renders sortable table. `IssueFiltersBar` for filtering. Issues page at `/projects/[projectKey]/issues`. |
| 8 | **Activity feed / audit log** | ✅ Confirmed | `ActivityLog` model in schema. `ActivityFeed` component. Activity logged on create, update, comment, attach. Project-level activity page at `/activity`. Dashboard shows recent activity. |
| 9 | **In-App Notifications** | ❌ Not Found | No `Notification` model in schema. No notification-related routes, server actions, or UI components anywhere in the codebase. |
| 10 | **User profile / avatar** | ✅ Confirmed | `User.avatarUrl` field in schema. `AvatarUpload` component. `PUT /api/avatar` and `GET /api/avatar` routes. Settings page. |
| 11 | **Search** | ✅ Confirmed | Full custom query language (parse → validate → execute pipeline in `src/lib/query/`). `QueryBar`, `QueryResults`, `SavedFilters` components. Search page at `/search`. Autocomplete suggestions implemented. |

**Bonus — File Attachments (listed as "Planned" in spec):** ✅ Fully built. `Attachment` model in schema. Six API routes (`/api/attachments/*`). `AttachmentsPanel` component with drag-and-drop, progress bar, delete with confirmation. Fully integrated into `IssueDetail`.

---

## Phase 3 — Data Model Audit (Section 10 of Spec)

Spec Section 10 describes the intended data model. The table below compares it to the actual `prisma/schema.prisma`.

| Spec Entity | In Schema? | Key Field Comparison |
|---|---|---|
| **User** | ✅ Yes | Schema has `role UserRole` (ADMIN/MEMBER). Spec says `globalRole (Admin \| TeamMember \| Viewer)` — **enum values differ**: spec uses three values; schema uses two (ADMIN/MEMBER — no VIEWER at user level). Spec says user `image`; schema uses `avatarUrl`. Spec says user "Belongs to one Workspace"; schema uses an Organisation multi-tenancy model instead. |
| **Workspace** | ❌ Not found | Spec defines `Workspace` with `id, name, slug`. The schema has `Organization` (with `id, name, slug, plan, ownerId`) which serves this purpose. The conceptual entity exists but is named differently and has additional fields (`plan`, `ownerId`, subscription). |
| **Project** | ⚠️ Partial | Schema has `Project` with `id, name, key, description, orgId`. Spec requires `isPrivate (boolean)` and `status (active/archived)` fields — **both are absent from the schema**. |
| **ProjectMember** | ⚠️ Partial | Schema has `ProjectMember` with roles OWNER/ADMIN/MEMBER/VIEWER. Spec says `projectRole (ProjectLead \| TeamMember \| Viewer)`. **Role enum values differ**: schema uses OWNER/ADMIN/MEMBER/VIEWER (four roles); spec defines ProjectLead/TeamMember/Viewer (three roles, different names). |
| **Issue** | ⚠️ Partial | Schema stores `status IssueStatus` as a raw enum (TODO/IN_PROGRESS/IN_REVIEW/DONE). Spec requires `statusId` as an FK to a separate `Status` model with custom named statuses. The two-layer workflow model described in Sections 5 and 12 is not implemented. `assigneeId` in schema is a single user FK; spec describes "one or more team members" implying many-to-many. |
| **Status** | ❌ Not found | Spec Section 5 and 10 describe a `Status` model with `id, name, color, category, order, scopeType`. Not present in schema. Issue status is a fixed 4-value enum instead. |
| **Comment** | ✅ Yes | Schema matches spec: `id, body, authorId, issueId, createdAt`. Schema adds `updatedAt`. |
| **Label** | ⚠️ Partial | Spec defines `Label` as a model with `id, name, color, projectId` in a many-to-many with Issues. Schema implements labels as `labels String[]` array on the `Issue` model — **no standalone Label model, no colour per label, no project-level label management**. |
| **Attachment** | ✅ Yes (built) | Spec lists as "Planned"; it is fully implemented. Schema has `Attachment` with `id, issueId, uploaderId, fileName, fileKey, fileSize, mimeType, createdAt`. Spec anticipated `filename, url, mimeType, size, issueId, uploaderId` — schema uses `fileKey` (S3 key) rather than a direct `url`, which is correct for presigned URL architecture. |
| **Notification** | ❌ Not found | Spec requires `Notification` with `id, type, message, userId, issueId, read, createdAt`. Completely absent from the schema and codebase. |
| **Activity** | ✅ Yes (named differently) | Spec calls it `Activity`; schema calls it `ActivityLog`. Fields align: `id, action, field, oldValue, newValue, userId, issueId, createdAt`. Spec additionally references `projectId` on Activity; schema omits it (activity is accessed via `issue.projectId`). |
| **Milestone** | ❌ Not found | Not in schema. Listed as "Planned" in roadmap. |
| **Sprint** | ❌ Not found | Not in schema. Listed as "Planned" in roadmap. |

**Models in schema NOT mentioned in spec Section 10:**
- `Organization` (spec calls this concept "Workspace")
- `OrgMember` (org-level membership, separate from ProjectMember)
- `OrgInvite` (invitation token system)
- `Subscription` (Stripe billing infrastructure)
- `Board` (named board per project)
- `Column` (named Kanban columns per board)
- `SavedFilter` (persisted search queries)

---

## Phase 4 — Auth & Permissions Audit

| Check | Result | Notes |
|---|---|---|
| JWT mode (no PrismaAdapter) | ✅ Pass | `session: { strategy: "jwt" }` in `auth.config.ts`. `@auth/prisma-adapter` is in `package.json` but not used in `auth.ts`. |
| GitHub OAuth provider | ❌ Fail | **Not implemented.** Spec Section 3 and Section 8 state GitHub OAuth is "Built". Only `Credentials` provider is registered in `auth.ts`. `authConfig.providers` is `[]` (empty array) in `auth.config.ts`. |
| Credentials provider | ✅ Pass | `Credentials` provider in `auth.ts` with bcrypt password verification against `User.passwordHash`. |
| `trustHost: true` | ✅ Pass | Set in `auth.config.ts` line 6. |
| Middleware protects authenticated routes | ✅ Pass | `src/middleware.ts` redirects unauthenticated users on all non-public routes. Public exceptions: `/login`, `/register`, `/api/auth/register`. **Note:** API routes other than register pass through without JWT check in middleware — they rely on per-handler `auth()` calls, which is valid but means a misconfigured handler would be unprotected. |
| Per-project role enforcement | ✅ Pass | `requireProjectRole()` in `src/lib/permissions.ts` enforces role checks on all project server actions. `canEditIssues`, `canManageMembers`, `canEditSettings`, `canManageProject` helpers with clear hierarchy (OWNER > ADMIN > MEMBER > VIEWER). Assignee validation checks `ProjectMember` row before allowing assignment. |
| Admin route protection | ✅ Pass | `requireAdmin()` in both `src/lib/permissions.ts` and `src/app/(dashboard)/admin/actions.ts` checks `session.user.role === "ADMIN"`. Admin sidebar link hidden from non-admins. |
| Self-registration blocked | ⚠️ Partial | `POST /api/auth/register` is public and allows self-registration. The spec (Section 2) states "Accounts are created manually by an Admin. There is no self-registration or public sign-up flow." The `/register` page exists and works. This is a direct spec conflict. |

---

## Phase 5 — Real-Time (SSE) Audit

**No SSE implementation exists in the codebase.**

A search for `text/event-stream`, `EventSource`, `ReadableStream` (for streaming), and `SSE` across all `.ts` and `.tsx` files returns zero results.

The spec (Section 7) states: *"JedForge is a fully real-time collaborative application. All connected users see changes reflected instantly without requiring a page refresh."* and lists the following as SSE-powered: issue status changes, new comments, assignments, subtask updates, activity feed updates, and in-app notification delivery.

**What is actually implemented instead:**

The application uses a polling-based approach via `AutoRefresh.tsx` (`src/components/layout/AutoRefresh.tsx`), which calls `router.refresh()` on a 3-minute interval (`REFRESH_INTERVAL_MS = 3 * 60 * 1000`). This component is mounted on the board page and issues list page. Changes are not pushed to other users in real time — they will only see updates after their browser polls on the next interval or on navigation.

This is a significant gap between spec intent and implementation. The Activity Feed in Section 4 is specifically described as "Real-time SSE-powered" but is rendered as a static server component with no streaming.

---

## Phase 6 — Navigation & Theming Audit

| Check | Result | Notes |
|---|---|---|
| `next-themes` installed and configured | ✅ Pass | `next-themes` in `package.json`. `ThemeProvider attribute="class" defaultTheme="system" enableSystem` in `src/app/layout.tsx`. |
| `@custom-variant dark` in globals.css | ✅ Pass | `@custom-variant dark (&:where(.dark, .dark *));` confirmed in `src/app/globals.css` line 5. Matches spec requirement exactly. |
| Light/dark logo swap | ✅ Pass | `logo-light.png` and `logo-dark.png` in `/public/`. Sidebar uses `block dark:hidden` / `hidden dark:block` pattern to swap logos. Mobile header also swaps correctly. |
| Favicon referencing JF icon package | ✅ Pass | `src/app/layout.tsx` metadata sets `icon` to `/icons/light/favicon-32.png` and `/icons/light/favicon-16.png`, `apple` to `/icons/light/icon-128.png`. Both light and dark icon sets exist in `/public/icons/`. |
| Web manifest referencing JF icons | ✅ Pass | `/public/site.webmanifest` references `/icons/light/icon-512.png` and `/icons/light/icon-256.png`. `theme_color` is `#FF6A00` (matches spec brand colour). |
| Navigation structure — top nav | ⚠️ Partial | The spec describes "a persistent top navigation bar across all views containing logo, global search, notifications, and user profile access." The actual `Header` component (`src/components/layout/Header.tsx`) contains only breadcrumbs, a theme toggle, and a "Create Issue" button. **There is no global search in the top nav** (search is a separate page at `/search` accessed via sidebar or `/` keyboard shortcut). **There are no notifications in the top nav** (no notification system exists). The logo is in the sidebar, not a top bar. |
| Navigation structure — contextual sidebar | ⚠️ Partial | Sidebar (`src/components/layout/Sidebar.tsx`) is present and shows Dashboard, Search, Projects, and Admin links. Within a project, `ProjectNav` provides Board, Issues, Activity, Settings tabs. The spec describes the sidebar including "backlog, milestones, sprints, settings, and members" — backlog, milestones, and sprints are absent because those features are not built. |
| Theme toggle accessible from top nav | ✅ Pass | `ThemeToggle` is rendered in `Header.tsx` (the top bar). |

---

## Phase 7 — Undocumented Items

### Models in Schema Not in Spec Section 10

| Model | Notes |
|---|---|
| `Organization` | Multi-tenant org model. Spec calls this entity "Workspace" but the schema uses a different name with more fields (plan, ownerId, subscription FK). |
| `OrgMember` | Org-level membership with OWNER/ADMIN/MEMBER roles. Spec has no equivalent; spec only describes WorkspaceMember implicitly through the global roles concept. |
| `OrgInvite` | Token-based invite system for org membership. Not mentioned anywhere in the spec. |
| `Subscription` | Full Stripe billing schema (stripeCustomerId, stripeSubscriptionId, stripePriceId, SubscriptionStatus enum, cancelAtPeriodEnd). The spec mentions monetization as "not yet decided" (Section 12 Open Decision #4). Having a Stripe schema suggests early billing infrastructure that is undocumented. |
| `Board` | Named boards per project. Partially supersedes the implicit "the Kanban board" in the spec. Currently only used to hold `Column` records. |
| `Column` | Named, coloured, ordered Kanban columns per board. Spec implies columns are fixed to the IssueStatus enum. The `Column` model exists but does not drive the board rendering — `KanbanBoard.tsx` hard-codes `STATUSES: IssueStatus[]` and does not query `Column` records. This model is defined but effectively unused. |
| `SavedFilter` | Named saved search queries, per-user with an `isGlobal` flag for admin-shared filters. Not mentioned in spec. |
| `Plan` enum | FREE/PRO/TEAM plan tiers on Organization. Undocumented. |
| `SubscriptionStatus` enum | TRIALING/ACTIVE/PAST_DUE/CANCELED/INCOMPLETE. Undocumented. |

### API Routes / Server Actions with No Corresponding Spec Feature

| Area | Notes |
|---|---|
| `/api/attachments/*` (6 routes) | Spec lists File Attachments as "Planned" (not yet built), but it is fully implemented with two upload paths (presign-then-PUT and direct multipart POST). |
| Admin panel (`/admin/users`, `/admin/projects`, `/admin/orgs`) | A full admin CRUD interface for users, projects, and orgs exists. The spec mentions an Admin role and admin capabilities but does not describe any admin UI pages. |
| Organisation management (`adminCreateOrg`, `adminDeleteOrg`, `adminAddOrgMember`, `adminRemoveOrgMember`) | Full organisation lifecycle management in `admin/actions.ts`. Undocumented in spec. |
| `SavedFilter` CRUD (`filter-actions.ts`) | Save, update, delete named search filters. Not in spec. |
| Query language engine (`src/lib/query/`) | A full custom query language with parser, validator, and Prisma query executor. Supports 11+ fields, 8+ operators, logical AND/OR, ORDER BY, date functions, and EMPTY/currentUser() specials. Spec mentions "Global search across issues, projects, and users" but does not describe a query language. Note: spec Section 8 has a warning "No competitor product names (e.g. 'JQL') should appear in the JedForge UI" — the implementation correctly avoids the JQL name. |
| `changePassword` action (`settings/actions.ts`) | Password change in user settings. Not described in spec. |
| `createUserAndAddToProject` server action | Admin creates a new user account directly from project settings. Not described in spec. |

### Major Components Not Covered by Spec

- `ProjectShortcuts.tsx` — keyboard shortcut `N` to open Create Issue dialog within a project context
- `AutoRefresh.tsx` — polling-based "real-time" substitute (3-min interval)
- `AvatarUpload.tsx` with presigned S3 routing — detailed implementation not in spec
- `ConfirmDialog.tsx` — Base UI dialog primitive (spec says no Radix UI, this correctly uses `@base-ui/react`)
- `RichTextEditor.tsx` / `RichTextDisplay.tsx` — TipTap v2 rich text (described in CLAUDE.md but absent from spec)
- Admin pages: `AdminUsersClient.tsx`, `AdminProjectsClient.tsx`, `AdminOrgsClient.tsx`

### Third-Party Libraries in `package.json` Not Listed in Spec Section 3

| Library | Purpose |
|---|---|
| `@tiptap/react`, `@tiptap/starter-kit` + extensions | Rich text editor for issue descriptions and comments |
| `@base-ui/react` | Accessible UI primitives (replaces shadcn/Radix for dialogs) |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | S3-compatible file storage client |
| `bcryptjs` | Password hashing |
| `date-fns` | Date formatting in ActivityFeed |
| `sonner` | Toast notifications |
| `vitest` | Unit test runner (tests exist for kanban, permissions, query parser/executor, tenancy, saved filters) |
| `playwright` | E2E test runner (installed but no test files found) |
| `tw-animate-css` | Tailwind CSS animation utilities |
| `class-variance-authority`, `clsx`, `tailwind-merge` | CSS class utilities |
| `lucide-react` | Icon library |

---

## Recommended Spec Updates

The spec (currently v1.2 internally, filed as v1.0) needs the following updates to match reality:

1. **Section 4 — Feature table:**
   - Change "File Attachments" from **Planned → Built**. The implementation is complete: Prisma model, six API routes, `AttachmentsPanel` component with drag-and-drop and progress.
   - Change "In-App Notifications" status from **Built → Not Built**. No model, no routes, no UI exist.
   - Add a note that "Activity Feed / Audit Log" is **not real-time** (polling only, not SSE).
   - Add new "Built" entries for: **Admin Panel** (user/project/org management), **Saved Filters** (named search queries), **Rich Text Descriptions/Comments** (TipTap).

2. **Section 7 — Real-Time Collaboration:**
   - The entire section describes a fully real-time SSE application. This is aspirational, not current. Should be rewritten to say real-time is **planned** and current behaviour is polling-based (`AutoRefresh` at 3-minute intervals).

3. **Section 8 — Integrations:**
   - Remove GitHub OAuth from "Built" status or add a note that it is **not yet implemented** in code (only Credentials provider exists).

4. **Section 10 — Data Model Summary:**
   - Rename "Workspace" → "Organization" to match the schema model name.
   - Remove `Workspace` entity row; replace with `Organization` (add `plan`, `ownerId`, `slug` fields).
   - Add `OrgMember` entity row.
   - Add `OrgInvite` entity row.
   - Add `Subscription` entity row (acknowledge Stripe billing schema exists even if billing logic is not yet active).
   - Add `Board` and `Column` entity rows.
   - Add `SavedFilter` entity row.
   - Update `User.globalRole` to match actual enum: `ADMIN | MEMBER` (not `Admin | TeamMember | Viewer`).
   - Update `Project` — remove `isPrivate` (not in schema), remove `status (active/archived)` (not in schema).
   - Update `ProjectMember.projectRole` — actual values are `OWNER | ADMIN | MEMBER | VIEWER` (not `ProjectLead | TeamMember | Viewer`).
   - Update `Issue.status` — implemented as a fixed 4-value enum (`TODO | IN_PROGRESS | IN_REVIEW | DONE`), not as a `statusId` FK. The two-layer custom workflow system from Section 5 is not built.
   - Update `Label` — implemented as `String[]` array on Issue (not a standalone model with colour).
   - Remove `Status` entity (not implemented).
   - Remove `Milestone` entity from "exists" listing (not implemented; correctly listed in roadmap).
   - Remove `Sprint` entity from "exists" listing (not implemented; correctly listed in roadmap).

5. **Section 2 — Account Creation:**
   - Self-registration via `/register` page is **currently functional** in the codebase, contradicting the "no self-registration" statement. Clarify whether self-registration is intentional or should be locked down.

6. **Section 6 — Navigation:**
   - Update to reflect actual structure: persistent sidebar (not top nav) with logo, main navigation links, and user menu. Header bar contains breadcrumbs, theme toggle, and Create Issue button. Notifications and global search bar in top nav do not exist yet.

---

## Recommended Code Updates

These are gaps where the spec says "Built" but the code is Partial or Not Found, ranked by impact:

### Priority 1 — Critical Gaps

**1. In-App Notifications (❌ Not Found — spec says "Built")**
- Add `Notification` model to `prisma/schema.prisma`: `id, type, message, userId, issueId, read, createdAt`.
- Create notifications when issues are assigned, comments are posted, or status changes.
- Add a notification bell to the Header with unread count badge.
- Add a notifications API route or server action for mark-read.
- This is listed as "Built" in spec Section 4 — it is the single biggest discrepancy.

**2. GitHub OAuth (❌ Not Found — spec and Section 8 say "Built")**
- Add `GitHub` provider from `next-auth/providers/github` to `src/lib/auth.ts`.
- Add `GITHUB_ID` and `GITHUB_SECRET` environment variables.
- The `@auth/prisma-adapter` package is already in `package.json` but unused. For JWT mode (no adapter), GitHub OAuth should work without Prisma adapter — just ensure the JWT callback maps `user.id` from the GitHub profile.
- Add a "Sign in with GitHub" button to the login page.

**3. Project Archive (⚠️ Partial — spec says "Built")**
- Add `isArchived Boolean @default(false)` and/or `status String @default("active")` to the `Project` model.
- Add an archive/unarchive server action.
- Filter archived projects out of the default project list.
- Add an "Archive project" action in project settings Danger Zone (below delete).

### Priority 2 — Data Model Alignment

**4. Real-Time / SSE (Spec Section 7 entirely unimplemented)**
- The spec commits to SSE for board updates, activity feed, and notifications. The current `AutoRefresh` polling at 3 minutes is a significant UX degradation from the spec promise.
- Implement a `GET /api/sse` route that streams `text/event-stream` events.
- Or, as a pragmatic interim step, reduce `AutoRefresh` interval significantly (e.g., 15–30 seconds) and document this as the current real-time mechanism pending SSE work.

**5. `isPrivate` field on Project (missing from schema)**
- Spec Section 2 describes private projects extensively. Add `isPrivate Boolean @default(false)` to `Project`.
- Add middleware/query filtering so private projects are invisible to non-members in project lists and search results.
- Add Admin-only toggle in project settings.

**6. Column / Board model is unused**
- `Board` and `Column` models exist in the schema but `KanbanBoard.tsx` hard-codes `STATUSES: IssueStatus[]` and never queries these models.
- Either: (a) remove `Board`/`Column` from the schema if they are not needed yet, or (b) wire the Kanban board to query `Column` records so column customisation becomes possible (prerequisite for the custom workflow feature).

### Priority 3 — Minor Gaps

**7. Self-registration vs. Admin-only accounts**
- Spec Section 2 states accounts are Admin-created only. The `/register` page is currently public and functional.
- Decision needed: if self-registration is intentional, update the spec. If not, disable the `/register` route and expose a user-creation UI only in the admin panel (which already has `adminCreateUser`).

**8. Label colour support**
- Labels are stored as `String[]` on issues with no colour metadata. The spec describes `Label` as a model with `name` and `color`.
- If coloured labels are desired, add a `Label` model or a `ProjectLabel` model and migrate from the string array approach.
