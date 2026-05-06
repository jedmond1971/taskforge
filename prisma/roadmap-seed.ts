/**
 * roadmap-seed.ts
 *
 * Creates a "JedForge Roadmap" project (key: JFR) in Alice's org and populates
 * it with all improvement Epics, Stories, and Tasks identified during the
 * codebase analysis.
 *
 * Run once from the project root:
 *   npx tsx prisma/roadmap-seed.ts
 *
 * Safe to re-run — it skips creation if the JFR project already exists.
 */

import {
  PrismaClient,
  IssueStatus,
  IssuePriority,
  IssueType,
  ProjectMemberRole,
} from "@prisma/client";

const prisma = new PrismaClient();

// ─── Types ───────────────────────────────────────────────────────────────────

type IssueInput = {
  title: string;
  description: string;
  type: IssueType;
  priority: IssuePriority;
  status?: IssueStatus;
  labels?: string[];
  children?: IssueInput[];
};

// ─── Issue Definitions ───────────────────────────────────────────────────────

const roadmap: IssueInput[] = [
  // ─── EPIC 1: Due Dates ──────────────────────────────────────────────────────
  {
    title: "Due Dates & Deadline Tracking",
    description:
      "Add due date support to issues so teams can track deadlines, surface overdue work, and sort by urgency. This is the single highest-impact missing field for any project management tool.",
    type: IssueType.EPIC,
    priority: IssuePriority.CRITICAL,
    labels: ["schema", "ux"],
    children: [
      {
        title: "Add dueDate field to Issue schema and run migration",
        description:
          "Add `dueDate DateTime?` to the Issue model in schema.prisma. Create and run a Prisma migration. Update createIssue, updateIssue server actions to accept and persist the field.",
        type: IssueType.TASK,
        priority: IssuePriority.CRITICAL,
        labels: ["schema", "backend"],
      },
      {
        title: "Due date picker on issue creation dialog",
        description:
          "Add a date picker to CreateIssueDialog. Use the native `<input type='date'>` or a lightweight picker component. Pass the value through the createIssue action.",
        type: IssueType.STORY,
        priority: IssuePriority.HIGH,
        labels: ["frontend"],
      },
      {
        title: "Inline due date editing on IssueDetail page",
        description:
          "Show the due date in the right-hand sidebar of IssueDetail. Allow inline editing with a date picker. Persist via updateIssue. Display a human-friendly relative label (e.g. 'Due in 3 days', 'Overdue by 2 days').",
        type: IssueType.STORY,
        priority: IssuePriority.HIGH,
        labels: ["frontend"],
      },
      {
        title: "Overdue indicator badges on Kanban cards",
        description:
          "Add a red 'Overdue' badge to KanbanCard when dueDate < today and status != DONE. Show the due date in muted text below the issue title so it's visible at a glance without cluttering the card.",
        type: IssueType.STORY,
        priority: IssuePriority.HIGH,
        labels: ["frontend", "kanban"],
      },
      {
        title: "Due date column and filter in issue list",
        description:
          "Add 'Due Date' as a sortable column in IssueList. Add a due date filter to IssueFiltersBar (overdue / due today / due this week / pick a date range). Persist filter state in URL search params.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend"],
      },
      {
        title: "Due date support in the query language",
        description:
          "Add dueDate as a recognized field in the query parser, validator, and executor. Support `dueDate < now()`, `dueDate = EMPTY`, and date function helpers. Add to autocomplete suggestions.",
        type: IssueType.TASK,
        priority: IssuePriority.MEDIUM,
        labels: ["backend", "query-engine"],
      },
      {
        title: "Show upcoming due dates on the home dashboard",
        description:
          "Replace or augment the 'Assigned to You' card on the dashboard home page with a due-date-aware view. Highlight overdue issues in red; issues due within 48 hours in amber.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend", "dashboard"],
      },
    ],
  },

  // ─── EPIC 2: Rich Text Editor ───────────────────────────────────────────────
  {
    title: "Rich Text / Markdown Editor for Descriptions and Comments",
    description:
      "Replace plain textarea fields with a rich text editor. Issue descriptions and comments should support headings, bold/italic, code blocks, checklists, and inline links. Plain text fallback must be handled gracefully for existing content.",
    type: IssueType.EPIC,
    priority: IssuePriority.HIGH,
    labels: ["ux", "frontend"],
    children: [
      {
        title: "Evaluate and select editor library (TipTap vs others)",
        description:
          "Compare TipTap, Lexical, and Quill for bundle size, Markdown support, SSR compatibility with Next.js 14, and license. Document decision and install chosen library.",
        type: IssueType.TASK,
        priority: IssuePriority.HIGH,
        labels: ["research"],
      },
      {
        title: "Integrate rich text editor for issue descriptions",
        description:
          "Replace the `<textarea>` in IssueDetail's description section with the chosen editor. Store content as Markdown or HTML (decide and be consistent). Handle existing plain-text content without breaking display.",
        type: IssueType.STORY,
        priority: IssuePriority.HIGH,
        labels: ["frontend"],
      },
      {
        title: "Integrate rich text editor for comments",
        description:
          "Replace CommentForm's textarea with the rich text editor. Ensure the editor resets cleanly after submission. Show a toolbar with at minimum: bold, italic, code, link, and unordered list.",
        type: IssueType.STORY,
        priority: IssuePriority.HIGH,
        labels: ["frontend"],
      },
      {
        title: "Rich text editor for issue creation dialog",
        description:
          "Add the editor to CreateIssueDialog's description field. Since the dialog is compact, use a minimal toolbar and allow the editor to expand vertically as the user types.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend"],
      },
      {
        title: "Read-only Markdown renderer for VIEWER role",
        description:
          "VIEWERs cannot edit issues. Ensure descriptions and comments render correctly as read-only rich text (no editor chrome). Use a lightweight renderer to avoid loading the full editor bundle for viewers.",
        type: IssueType.TASK,
        priority: IssuePriority.LOW,
        labels: ["frontend", "performance"],
      },
    ],
  },

  // ─── EPIC 3: Sub-Issues UI ──────────────────────────────────────────────────
  {
    title: "Sub-Issues UI",
    description:
      "The database already has a `parentId` foreign key on Issue, but there is no UI to create or view sub-issues. Wire up the existing schema to the front end so teams can break epics and stories down into smaller tasks.",
    type: IssueType.EPIC,
    priority: IssuePriority.MEDIUM,
    labels: ["frontend", "schema"],
    children: [
      {
        title: "Display sub-issues list on IssueDetail page",
        description:
          "Below the description on IssueDetail, show a 'Sub-issues' section. Fetch children via a new getSubIssues server action. Show key, title, status badge, and assignee avatar for each child. Show a count in the section header.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend"],
      },
      {
        title: "Create sub-issue from parent issue detail page",
        description:
          "Add a '+ Add sub-issue' button in the sub-issues section. On click, open an inline quick-create form (title + type, pre-populated project and parent). On save, call createIssue with parentId set.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend"],
      },
      {
        title: "Show parent issue breadcrumb on sub-issue detail",
        description:
          "When viewing a sub-issue, show a breadcrumb above the title: 'PROJECT > PARENT-KEY: Parent Title > CHILD-KEY'. Make the parent key a clickable link. Fetch parent details in getIssue.",
        type: IssueType.STORY,
        priority: IssuePriority.LOW,
        labels: ["frontend"],
      },
      {
        title: "Sub-issue progress rollup on parent issue",
        description:
          "On the parent issue detail, show a progress bar indicating what fraction of sub-issues are DONE. e.g. '3 / 7 done'. Calculated from the children count.",
        type: IssueType.STORY,
        priority: IssuePriority.LOW,
        labels: ["frontend"],
      },
    ],
  },

  // ─── EPIC 4: Invite System ──────────────────────────────────────────────────
  {
    title: "Email Invite System",
    description:
      "The OrgInvite model already exists in the schema with token, expiry, and role fields. Wire it up end-to-end: send invite emails, provide an accept/decline flow, manage pending invites from org settings. This is a hard blocker for onboarding any real client.",
    type: IssueType.EPIC,
    priority: IssuePriority.HIGH,
    labels: ["backend", "email"],
    children: [
      {
        title: "Set up transactional email provider (Resend or Postmark)",
        description:
          "Evaluate Resend vs Postmark for transactional email. Install SDK, add API key to .env, create a minimal send-email utility at lib/email.ts. Verify domain sending in staging.",
        type: IssueType.TASK,
        priority: IssuePriority.HIGH,
        labels: ["backend", "infrastructure"],
      },
      {
        title: "Invite member by email from org settings",
        description:
          "Add an 'Invite member' form to the org settings page (currently only accessible to admins). On submit, create an OrgInvite row and send an email with the accept link. Show pending invites in a list below.",
        type: IssueType.STORY,
        priority: IssuePriority.HIGH,
        labels: ["frontend", "backend"],
      },
      {
        title: "Accept invite flow (token-based landing page)",
        description:
          "Create /invite/[token] page. Verify the token is valid and not expired. If the invitee has no account, show a registration form pre-filled with their email. On submit, create User + OrgMember in a transaction and mark the invite as accepted.",
        type: IssueType.STORY,
        priority: IssuePriority.HIGH,
        labels: ["frontend", "backend"],
      },
      {
        title: "Resend and revoke pending invites",
        description:
          "In the pending invites list, add 'Resend' (regenerates token, sends new email) and 'Revoke' (deletes the OrgInvite row) buttons. Only org OWNER and ADMIN can perform these actions.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend", "backend"],
      },
      {
        title: "Expire invites after 7 days",
        description:
          "The OrgInvite model has an expiresAt field — use it. On invite creation, set expiresAt to now + 7 days. On the accept page, check expiry and show a 'This invite has expired — ask your admin to resend it' message if needed.",
        type: IssueType.TASK,
        priority: IssuePriority.MEDIUM,
        labels: ["backend"],
      },
    ],
  },

  // ─── EPIC 5: Notifications ──────────────────────────────────────────────────
  {
    title: "Notification System",
    description:
      "There are currently zero notifications in JedForge. Assigning someone an issue, commenting on their work, or mentioning them produces no signal. Build a foundational notification system: in-app bell + email digests.",
    type: IssueType.EPIC,
    priority: IssuePriority.HIGH,
    labels: ["backend", "frontend"],
    children: [
      {
        title: "Add Notification model to schema",
        description:
          "Create a Notification model: id, userId (recipient), type (enum: ASSIGNED, COMMENTED, MENTIONED, STATUS_CHANGED), issueId, actorId (who triggered it), read Boolean, createdAt. Add to User relation. Run migration.",
        type: IssueType.TASK,
        priority: IssuePriority.HIGH,
        labels: ["schema", "backend"],
      },
      {
        title: "Generate notifications on key issue events",
        description:
          "Emit notifications inside existing server actions: (1) createIssue / updateIssue with assigneeId change → notify new assignee, (2) addComment → notify issue reporter and assignee (except the commenter), (3) status change on an issue you reported → notify reporter.",
        type: IssueType.STORY,
        priority: IssuePriority.HIGH,
        labels: ["backend"],
      },
      {
        title: "In-app notification bell in header",
        description:
          "Add a bell icon to the Header component. Show an unread count badge. On click, open a dropdown listing the 10 most recent notifications with issue key, action description, and relative timestamp. 'Mark all as read' button.",
        type: IssueType.STORY,
        priority: IssuePriority.HIGH,
        labels: ["frontend"],
      },
      {
        title: "Email notification on issue assignment",
        description:
          "When an issue is assigned to a user (and the assignee is not the actor), send a transactional email: 'You've been assigned [PROJ-123]: Issue Title' with a direct link. Use the email utility from the invite epic.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["backend", "email"],
      },
      {
        title: "Notification preferences per user",
        description:
          "Add a Notifications section to the user settings page. Allow opting out of individual event types (assignment, comments, status changes) for both in-app and email channels.",
        type: IssueType.STORY,
        priority: IssuePriority.LOW,
        labels: ["frontend", "backend"],
      },
    ],
  },

  // ─── EPIC 6: Dashboard Analytics ────────────────────────────────────────────
  {
    title: "Dashboard Analytics & Charts",
    description:
      "The current home dashboard shows three static counts and a short assigned-issues list. Add charts and insights that give team leads a real picture of project health without having to open every project individually.",
    type: IssueType.EPIC,
    priority: IssuePriority.MEDIUM,
    labels: ["frontend", "dashboard"],
    children: [
      {
        title: "Issues created vs resolved chart (weekly trend)",
        description:
          "Add a line chart to the dashboard showing issues created vs issues moved to DONE per week over the last 8 weeks, across all the user's projects. Use recharts (already in the codebase via shadcn).",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend", "charts"],
      },
      {
        title: "Issues by status breakdown per project",
        description:
          "Add a compact stacked bar chart (or grouped badge counts) showing each project's issue breakdown by status. Allows a quick scan of which projects are bottlenecked in IN_REVIEW.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend", "charts"],
      },
      {
        title: "Overdue issues count and list on dashboard",
        description:
          "Once due dates exist (Epic 1), add an 'Overdue' stat card to the dashboard's three-column grid. Clicking it expands a list of overdue issues across all projects the user belongs to.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend", "dashboard"],
      },
      {
        title: "Make 'Assigned to You' issues clickable links",
        description:
          "The current Assigned to You card renders issues as `<div>` elements — they look clickable but aren't. Wrap each item in a `<Link href=/projects/[key]/issues/[issueKey]>`. Quick fix with high UX value.",
        type: IssueType.TASK,
        priority: IssuePriority.HIGH,
        labels: ["frontend", "bug"],
      },
    ],
  },

  // ─── EPIC 7: Bulk Actions ───────────────────────────────────────────────────
  {
    title: "Bulk Actions on Issue List",
    description:
      "Once a project has more than ~20 issues, changing status or reassigning one issue at a time becomes painful. Add multi-select and bulk operations to the issue list view.",
    type: IssueType.EPIC,
    priority: IssuePriority.MEDIUM,
    labels: ["frontend"],
    children: [
      {
        title: "Multi-select checkboxes on issue list rows",
        description:
          "Add a checkbox column to IssueList. A header checkbox selects/deselects all visible issues. Track selected issue IDs in local state. Show a selection count in the toolbar when any are selected.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend"],
      },
      {
        title: "Bulk status change",
        description:
          "When one or more issues are selected, show a 'Set Status' dropdown in the action toolbar. On confirm, call a new bulkUpdateIssues server action that updates all selected issue IDs. Revalidate the issue list.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend", "backend"],
      },
      {
        title: "Bulk assignee change",
        description:
          "Add an 'Assign to' dropdown to the bulk action toolbar. Shows project members. On select, call bulkUpdateIssues with the new assigneeId. Validate that the new assignee is a project member server-side.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend", "backend"],
      },
      {
        title: "Bulk label add / remove",
        description:
          "Add a 'Labels' button to the bulk action toolbar. Show a label picker with add/remove toggle. Merges the selected labels into each issue rather than replacing (so you can add 'urgent' to a batch without wiping existing labels).",
        type: IssueType.STORY,
        priority: IssuePriority.LOW,
        labels: ["frontend", "backend"],
      },
    ],
  },

  // ─── EPIC 8: CSV Export ─────────────────────────────────────────────────────
  {
    title: "CSV Export for Issue Lists",
    description:
      "Clients always want to pull their data into a spreadsheet for reporting or handoffs. Add a CSV export of the current filtered issue view — no external dependencies needed, just serialize the query result.",
    type: IssueType.EPIC,
    priority: IssuePriority.MEDIUM,
    labels: ["backend", "frontend"],
    children: [
      {
        title: "Server action / API route for CSV generation",
        description:
          "Create a GET /api/projects/[projectKey]/issues/export route. Accept the same filter and sort params as the issue list. Build the Prisma query, serialize results to CSV (key, title, status, priority, type, assignee, labels, created, updated), stream the response with Content-Disposition: attachment.",
        type: IssueType.TASK,
        priority: IssuePriority.MEDIUM,
        labels: ["backend"],
      },
      {
        title: "Export button on issue list toolbar",
        description:
          "Add a 'Export CSV' button (or icon button) to the IssueFiltersBar. On click, construct the export URL with current filter params and trigger a download. Show a brief toast: 'Preparing export...'",
        type: IssueType.TASK,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend"],
      },
    ],
  },

  // ─── EPIC 9: Issue Templates ────────────────────────────────────────────────
  {
    title: "Issue Templates",
    description:
      "Allow project admins to define reusable issue templates (e.g. 'Bug Report', 'Feature Request') with pre-populated titles, descriptions, types, labels, and priorities. Keeps issue quality consistent across a team.",
    type: IssueType.EPIC,
    priority: IssuePriority.LOW,
    labels: ["frontend", "backend"],
    children: [
      {
        title: "Add IssueTemplate model to schema",
        description:
          "Create IssueTemplate model: id, projectId, name, description (String), defaultTitle (String?), defaultDescription (String?), defaultType, defaultPriority, defaultLabels. Add relation to Project. Run migration.",
        type: IssueType.TASK,
        priority: IssuePriority.LOW,
        labels: ["schema", "backend"],
      },
      {
        title: "Create and manage templates from project settings",
        description:
          "Add a 'Templates' section to ProjectSettings. Allow OWNER and ADMIN to create, edit, and delete templates. Each template has a name and optional default values for type, priority, labels, and description boilerplate.",
        type: IssueType.STORY,
        priority: IssuePriority.LOW,
        labels: ["frontend", "backend"],
      },
      {
        title: "Template picker in CreateIssueDialog",
        description:
          "Add a 'Start from template' dropdown at the top of CreateIssueDialog. Selecting a template pre-populates the form fields. The user can then edit before saving. If no templates exist, the picker is hidden.",
        type: IssueType.STORY,
        priority: IssuePriority.LOW,
        labels: ["frontend"],
      },
    ],
  },

  // ─── EPIC 10: Custom Boards ─────────────────────────────────────────────────
  {
    title: "Wire Up or Remove Dead Board / Column Models",
    description:
      "The schema has Board and Column models (with position and color), but the Kanban board hardcodes the four IssueStatus values. Either wire these models up to allow custom board columns, or delete them to avoid misleading future contributors.",
    type: IssueType.EPIC,
    priority: IssuePriority.LOW,
    labels: ["backend", "frontend", "schema"],
    children: [
      {
        title: "Decision: custom columns vs remove Board/Column models",
        description:
          "Evaluate the effort of mapping issues to custom Column rows vs. removing the dead models. Custom columns require a column↔status mapping strategy and migration. Removal is safer if custom columns aren't on the near-term roadmap. Document the decision in CLAUDE.md.",
        type: IssueType.TASK,
        priority: IssuePriority.MEDIUM,
        labels: ["research"],
      },
      {
        title: "[If keeping] Wire Board model to KanbanBoard component",
        description:
          "Replace the hardcoded STATUSES array in KanbanBoard.tsx with columns loaded from the Board model. Each Column row maps to a status bucket. Add a default board creation step to createProject.",
        type: IssueType.STORY,
        priority: IssuePriority.LOW,
        labels: ["frontend", "backend"],
      },
      {
        title: "[If keeping] Allow custom column creation and renaming",
        description:
          "Add a board settings UI to the project settings page. Allow OWNER/ADMIN to add, rename, reorder, and delete columns. Deleting a column should prompt to re-assign any issues in it.",
        type: IssueType.STORY,
        priority: IssuePriority.LOW,
        labels: ["frontend", "backend"],
      },
      {
        title: "[If removing] Delete Board and Column models and migration",
        description:
          "Remove Board and Column from schema.prisma. Create and run a migration to drop the tables. Remove the createBoard call from seed.ts. Clean up any unused imports.",
        type: IssueType.TASK,
        priority: IssuePriority.LOW,
        labels: ["schema", "backend"],
      },
    ],
  },

  // ─── EPIC 11: Stripe Integration ────────────────────────────────────────────
  {
    title: "Stripe Billing Integration",
    description:
      "The Subscription and Plan models (FREE / PRO / TEAM) are fully defined in the schema but do nothing. Wire them up to Stripe: checkout, webhooks, plan enforcement. Required before any commercial client onboarding.",
    type: IssueType.EPIC,
    priority: IssuePriority.HIGH,
    labels: ["backend", "billing"],
    children: [
      {
        title: "Set up Stripe account, products, and price IDs",
        description:
          "Create Stripe products for Pro and Team tiers with monthly and annual prices. Add STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRO_PRICE_ID, STRIPE_TEAM_PRICE_ID to .env. Add stripe npm package.",
        type: IssueType.TASK,
        priority: IssuePriority.HIGH,
        labels: ["backend", "infrastructure"],
      },
      {
        title: "Stripe Checkout flow for plan upgrades",
        description:
          "Create a /api/billing/checkout POST route that creates a Stripe Checkout session for the selected plan. Redirect the user to Stripe. On success, Stripe calls the webhook which updates the Subscription row.",
        type: IssueType.STORY,
        priority: IssuePriority.HIGH,
        labels: ["backend"],
      },
      {
        title: "Stripe webhook handler",
        description:
          "Create /api/webhooks/stripe to handle: checkout.session.completed (activate subscription), invoice.payment_failed (mark PAST_DUE), customer.subscription.deleted (cancel). Verify signature with stripe.webhooks.constructEvent.",
        type: IssueType.STORY,
        priority: IssuePriority.HIGH,
        labels: ["backend"],
      },
      {
        title: "Billing settings page for org owners",
        description:
          "Add a Billing section to org settings (OWNER only). Show current plan, next billing date, and a 'Manage Billing' button that opens the Stripe Customer Portal. Show usage counts (members, projects) relevant to plan limits.",
        type: IssueType.STORY,
        priority: IssuePriority.HIGH,
        labels: ["frontend", "backend"],
      },
      {
        title: "Plan enforcement — gate features by tier",
        description:
          "Decide what each plan allows (e.g. FREE: 3 projects, 5 members; PRO: unlimited projects; TEAM: SSO). Add a checkPlanLimit utility and call it in the relevant server actions. Return a clear error message when limits are hit.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["backend"],
      },
    ],
  },

  // ─── EPIC 12: Issue Linking ─────────────────────────────────────────────────
  {
    title: "Issue Linking (Blocks / Relates To)",
    description:
      "Add the ability to link issues together with typed relationships: 'blocks', 'is blocked by', 'relates to'. Useful for dependency tracking and surfacing blockers during standups.",
    type: IssueType.EPIC,
    priority: IssuePriority.LOW,
    labels: ["schema", "frontend", "backend"],
    children: [
      {
        title: "Add IssueLink model to schema",
        description:
          "Create IssueLink model: id, sourceIssueId, targetIssueId, type (enum: BLOCKS, RELATES_TO). Add relations to Issue for inbound and outbound links. The inverse of BLOCKS is IS_BLOCKED_BY (derived, not stored). Run migration.",
        type: IssueType.TASK,
        priority: IssuePriority.LOW,
        labels: ["schema", "backend"],
      },
      {
        title: "Link / unlink issues from IssueDetail page",
        description:
          "Add a 'Linked issues' section to IssueDetail. 'Add link' button opens a search box (search by key or title within accessible projects), then a type selector (blocks / relates to). Save calls a new createIssueLink server action.",
        type: IssueType.STORY,
        priority: IssuePriority.LOW,
        labels: ["frontend", "backend"],
      },
      {
        title: "Display linked issues with relationship labels",
        description:
          "In the Linked issues section, show each linked issue as a row: relationship label ('Blocks', 'Is blocked by', 'Relates to'), issue key (link), title, and current status badge. Include an unlink button.",
        type: IssueType.STORY,
        priority: IssuePriority.LOW,
        labels: ["frontend"],
      },
    ],
  },

  // ─── EPIC 13: UX Polish ─────────────────────────────────────────────────────
  {
    title: "UX Polish & Quality Improvements",
    description:
      "A collection of smaller quality improvements that individually are quick wins but together significantly raise the app's perceived polish — the kind of details that matter when demoing to a prospective client.",
    type: IssueType.EPIC,
    priority: IssuePriority.MEDIUM,
    labels: ["ux", "frontend"],
    children: [
      {
        title: "Replace native confirm() dialogs with shadcn AlertDialog",
        description:
          "Every destructive action (delete issue, delete project, remove member, delete attachment) uses browser-native confirm() which looks unprofessional and can't be styled. Replace all occurrences with the shadcn AlertDialog component.",
        type: IssueType.TASK,
        priority: IssuePriority.HIGH,
        labels: ["frontend", "ux"],
      },
      {
        title: "Keyboard shortcut: N to create a new issue",
        description:
          "When focus is not inside an input, pressing 'N' anywhere in the project context should open CreateIssueDialog. Use a global keydown listener in the project layout. Show a keyboard shortcut hint in the 'Create Issue' button tooltip.",
        type: IssueType.TASK,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend", "ux"],
      },
      {
        title: "Keyboard shortcut: / to focus the search bar",
        description:
          "Pressing '/' anywhere (outside an input) should focus the global search/query bar. Standard convention across web apps. Add a '/' hint label inside the search input as placeholder text.",
        type: IssueType.TASK,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend", "ux"],
      },
      {
        title: "Empty states with actionable CTAs",
        description:
          "Several empty states (no projects, no issues, no members) show a plain text message. Replace them with illustrated or icon-based empty states that include a clear CTA (e.g. 'Create your first issue' button). Improves first-run experience.",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend", "ux"],
      },
      {
        title: "Avatar upload on user settings page",
        description:
          "The User model has an avatarUrl field and avatars are shown throughout the UI, but there is no way to set one. Add an avatar upload control to the Settings page. Resize client-side to 256x256 and upload to S3 (reuse the existing S3 utility).",
        type: IssueType.STORY,
        priority: IssuePriority.MEDIUM,
        labels: ["frontend", "backend"],
      },
      {
        title: "Loading skeletons on the Kanban board",
        description:
          "The board page currently has no loading skeleton — it shows a blank white screen while fetching. Add skeleton card placeholders inside each column using the existing skeleton.tsx component to reduce perceived load time.",
        type: IssueType.TASK,
        priority: IssuePriority.LOW,
        labels: ["frontend", "ux"],
      },
    ],
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Find Alice (or the first admin user as a fallback)
  const reporter = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
  });

  if (!reporter) {
    throw new Error(
      "No admin user found. Run the main seed first: npm run db:seed"
    );
  }

  // Find Alice's org
  const org = await prisma.organization.findFirst({
    where: { ownerId: reporter.id },
  });

  if (!org) {
    throw new Error(`No organization found for user ${reporter.email}`);
  }

  // Check if the JFR project already exists
  const existing = await prisma.project.findUnique({ where: { key: "JFR" } });
  if (existing) {
    console.log(
      "⚠️  Project JFR already exists — skipping. Delete it first if you want to re-seed."
    );
    return;
  }

  // Create the roadmap project
  const project = await prisma.project.create({
    data: {
      name: "JedForge Roadmap",
      key: "JFR",
      description:
        "Improvement backlog for JedForge itself — Epics, Stories, and Tasks derived from the product analysis. Use this project to track all planned enhancements.",
      orgId: org.id,
      members: {
        create: { userId: reporter.id, role: ProjectMemberRole.OWNER },
      },
    },
  });

  console.log(`✅ Created project: ${project.name} (${project.key})`);

  // Helper: generate the next issue key
  let issueCounter = 0;
  function nextKey() {
    return `JFR-${++issueCounter}`;
  }

  // Helper: create an issue with optional parentId
  async function createIssue(
    input: IssueInput,
    position: number,
    parentId?: string
  ) {
    const issue = await prisma.issue.create({
      data: {
        key: nextKey(),
        projectId: project.id,
        reporterId: reporter!.id,
        title: input.title,
        description: input.description,
        type: input.type,
        priority: input.priority,
        status: input.status ?? IssueStatus.TODO,
        labels: input.labels ?? [],
        position,
        parentId: parentId ?? null,
      },
    });

    await prisma.activityLog.create({
      data: { issueId: issue.id, userId: reporter!.id, action: "created" },
    });

    return issue;
  }

  // Create all epics and their children
  let epicCount = 0;
  let childCount = 0;

  for (let i = 0; i < roadmap.length; i++) {
    const epicInput = roadmap[i];
    const epic = await createIssue(epicInput, i);
    epicCount++;

    if (epicInput.children) {
      for (let j = 0; j < epicInput.children.length; j++) {
        await createIssue(epicInput.children[j], j, epic.id);
        childCount++;
      }
    }
  }

  const total = epicCount + childCount;

  console.log(`\n🗂  JedForge Roadmap created successfully`);
  console.log(`   Project key : JFR`);
  console.log(`   Reporter    : ${reporter.email}`);
  console.log(`   Org         : ${org.name}`);
  console.log(`   Epics       : ${epicCount}`);
  console.log(`   Stories/Tasks: ${childCount}`);
  console.log(`   Total issues: ${total}`);
  console.log(
    `\n   Open the app and navigate to the JFR project to see your roadmap.\n`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
