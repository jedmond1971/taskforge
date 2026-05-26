import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  HeadingLevel,
  ShadingType,
  BorderStyle,
  LevelFormat,
  NumberFormat,
} from '/home/jamie/.npm-global/lib/node_modules/docx/dist/index.mjs';
import { writeFileSync } from 'fs';

// ── Helpers ──────────────────────────────────────────────────────────────────

const FONT = 'Arial';
const ACCENT = '1F3864'; // dark navy header fill
const HEADER_FG = 'FFFFFF';
const ROW_ALT = 'F2F2F2';
const BORDER_CLR = 'BFBFBF';

const cellBorder = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: BORDER_CLR },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_CLR },
  left:   { style: BorderStyle.SINGLE, size: 4, color: BORDER_CLR },
  right:  { style: BorderStyle.SINGLE, size: 4, color: BORDER_CLR },
};

function pt(n) { return n * 20; }   // points → half-points (twips for font size)
function dxa(inches) { return Math.round(inches * 1440); }

function run(text, opts = {}) {
  return new TextRun({
    text,
    font: FONT,
    size: pt(opts.size ?? 10),
    bold: opts.bold ?? false,
    italics: opts.italic ?? false,
    color: opts.color,
    break: opts.break,
  });
}

function para(runs, opts = {}) {
  const children = Array.isArray(runs) ? runs : [typeof runs === 'string' ? run(runs) : runs];
  return new Paragraph({
    children,
    spacing: { before: opts.spaceBefore ?? 40, after: opts.spaceAfter ?? 40 },
    alignment: opts.alignment ?? AlignmentType.LEFT,
    indent: opts.indent ? { left: dxa(opts.indent) } : undefined,
    bullet: opts.bullet ? { level: 0 } : undefined,
    numbering: opts.numbering,
    style: opts.style,
  });
}

function h1(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: pt(20), bold: true, color: '1a1a2e' })],
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 280, after: 100 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'F05A28' },
    },
    outlineLevel: 0,
  });
}

function h2(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: pt(14), bold: true, color: 'F05A28' })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 80 },
    outlineLevel: 1,
  });
}

function h3(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: pt(11), bold: true })],
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 160, after: 60 },
    outlineLevel: 2,
  });
}

function bullet(text, level = 0) {
  const indentLeft  = dxa(0.25 + level * 0.25);
  const indentHanging = dxa(0.25);
  return new Paragraph({
    children: [new TextRun({ text, font: FONT, size: pt(10) })],
    numbering: { reference: 'bullet-numbering', level },
    indent: { left: indentLeft, hanging: indentHanging },
    spacing: { before: 20, after: 20 },
  });
}

function blank(space = 80) {
  return new Paragraph({ children: [], spacing: { before: space, after: 0 } });
}

function note(text) {
  return new Paragraph({
    children: [
      new TextRun({ text: '⚠ Note: ', font: FONT, size: pt(9), bold: true, color: 'C55A11' }),
      new TextRun({ text, font: FONT, size: pt(9), italics: true, color: '595959' }),
    ],
    spacing: { before: 60, after: 60 },
    indent: { left: dxa(0.25) },
  });
}

function headerCell(text, widthDxa) {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: '1F3864', color: '1F3864' },
    borders: cellBorder,
    children: [new Paragraph({
      children: [new TextRun({ text, font: FONT, size: pt(9), bold: true, color: 'FFFFFF' })],
      spacing: { before: 40, after: 40 },
    })],
  });
}

function dataCell(text, widthDxa, shade = false) {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: shade ? ROW_ALT : 'FFFFFF', color: shade ? ROW_ALT : 'FFFFFF' },
    borders: cellBorder,
    children: [new Paragraph({
      children: [new TextRun({ text, font: FONT, size: pt(9) })],
      spacing: { before: 40, after: 40 },
    })],
  });
}

// ── Page metrics ─────────────────────────────────────────────────────────────

// US Letter 12240 × 15840 DXA, 1-inch margins → usable width = 12240 - 2×1440 = 9360
const PAGE_W    = 12240;
const PAGE_H    = 15840;
const MARGIN    = 1440;
const BODY_W    = PAGE_W - 2 * MARGIN; // 9360

// ── Numbering (bullets) ───────────────────────────────────────────────────────

const bulletNumbering = {
  config: [
    {
      reference: 'bullet-numbering',
      levels: [0, 1, 2].map(level => ({
        level,
        format: LevelFormat.BULLET,
        text: level === 0 ? '•' : level === 1 ? '◦' : '▪',
        alignment: AlignmentType.LEFT,
        style: {
          paragraph: {
            indent: {
              left: dxa(0.25 + level * 0.25),
              hanging: dxa(0.25),
            },
          },
          run: { font: FONT, size: pt(10) },
        },
      })),
    },
  ],
};

// ── Table helpers ─────────────────────────────────────────────────────────────

function twoColTable(rows, colWidths) {
  const [w0, w1] = colWidths;
  return new Table({
    width: { size: BODY_W, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: rows.map(([a, b], i) => new TableRow({
      children: [
        dataCell(a, w0, i % 2 !== 0),
        dataCell(b, w1, i % 2 !== 0),
      ],
    })),
  });
}

function headerTable(headers, dataRows, colWidths) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => headerCell(h, colWidths[i])),
  });
  const bodyRows = dataRows.map(([...cells], i) => new TableRow({
    children: cells.map((c, ci) => dataCell(c, colWidths[ci], i % 2 !== 0)),
  }));
  return new Table({
    width: { size: BODY_W, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...bodyRows],
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  DOCUMENT CONTENT
// ══════════════════════════════════════════════════════════════════════════════

const sections = [

  // ── Title page ──────────────────────────────────────────────────────────────
  new Paragraph({
    children: [new TextRun({ text: 'JedForge', font: FONT, size: pt(36), bold: true, color: 'F05A28' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: dxa(1.5), after: 60 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Functional Specification Document', font: FONT, size: pt(18), color: '444444' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Version 2.0  •  May 2026', font: FONT, size: pt(11), color: '888888' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'jedforge.com', font: FONT, size: pt(10), color: '888888' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 60 },
  }),
  new Paragraph({
    children: [new TextRun({ text: 'Source-available. All rights reserved.', font: FONT, size: pt(9), color: 'AAAAAA', italics: true })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: dxa(1.5) },
  }),

  // ════════════════════════════════════════════════════════════════════════════
  // 1. DOCUMENT INFO
  // ════════════════════════════════════════════════════════════════════════════
  h1('1.  Document Information'),

  headerTable(
    ['Field', 'Value'],
    [
      ['Document Title',   'JedForge Functional Specification'],
      ['Version',          '2.0'],
      ['Status',           'Active / Living Document'],
      ['Date',             'May 2026'],
      ['Author',           'Jamie Edmondson'],
      ['Prior Version',    '1.4 (archived at .context-docs/JedForge-FunctionalSpec-v1.0.docx)'],
    ],
    [Math.round(BODY_W * 0.28), Math.round(BODY_W * 0.72)],
  ),

  blank(100),
  para([run('What changed in v2.0:', { bold: true })]),
  bullet('Docs module fully documented (DocSpace, sections, pages, file uploads, version history, cross-links)'),
  bullet('Notifications system documented (model, bell UI, four event types)'),
  bullet('Multi-tenancy (Organization / OrgMember) fully documented'),
  bullet('Avatar upload system documented'),
  bullet('Query language (FQL) formally documented — grammar, parser architecture, saved filters'),
  bullet('Attachment API routes documented in detail'),
  bullet('Subscription/Stripe model documented'),
  bullet('Roles & Permissions matrix updated to cover OrgRole + ProjectMemberRole'),
  bullet('Tech stack updated: @base-ui/react, vitest, tw-animate-css, date-fns'),
  bullet('SSE status updated — still planned, not yet implemented'),

  // ════════════════════════════════════════════════════════════════════════════
  // 2. PROJECT OVERVIEW
  // ════════════════════════════════════════════════════════════════════════════
  h1('2.  Project Overview'),

  para('JedForge is a team-based project management application designed for small-to-medium teams of up to 50 members. It provides structured issue tracking, a Kanban board, collaborative documentation (the Docs module), rich-text commenting, and a purpose-built filter query language — all deployed as a single Next.js application on Railway.'),

  h2('Mission Statement'),
  para('To provide small-to-medium teams with a powerful, focused project management tool that is fast to adopt, easy to maintain, and purpose-built for real engineering workflows.'),

  h2('Deployment'),
  bullet('Production URL: jedforge.com'),
  bullet('Hosted on Railway (Hobby plan)'),
  bullet('Domain managed via IONOS'),
  bullet('Repository: github.com/jedmond1971/taskforge (source-available, all rights reserved)'),

  h2('Multi-Tenant Architecture'),
  para('JedForge is a multi-tenant product. Each client organization is logically isolated: every Project belongs to exactly one Organization, and user-to-project relationships are validated against the project\'s Organization. Users may belong to multiple organizations.'),
  bullet('Registration creates a User + default Organization + OWNER OrgMember in one transaction.'),
  bullet('Project member search returns only OrgMembers of the project\'s org who are not already members.'),
  bullet('Issue assignees must hold a ProjectMember row for the same project.'),
  bullet('Org deletion is blocked if the org still has projects.'),
  bullet('OrgMember removal is blocked if the user has ProjectMember rows in that org.'),

  // ════════════════════════════════════════════════════════════════════════════
  // 3. TECHNOLOGY STACK
  // ════════════════════════════════════════════════════════════════════════════
  h1('3.  Technology Stack'),

  headerTable(
    ['Category', 'Technology', 'Notes'],
    [
      ['Framework',       'Next.js 14 (App Router)', 'TypeScript throughout; server and client components'],
      ['Database',        'PostgreSQL via Prisma ORM 5.x', 'Local dev on port 5433 (Docker); Railway Postgres in prod'],
      ['Auth',            'NextAuth.js v5 (beta)', 'JWT + Credentials only. PrismaAdapter intentionally omitted.'],
      ['UI Library',      '@base-ui/react ^1.3.0', 'NOT Radix UI. Custom components built on Base UI primitives.'],
      ['Styling',         'Tailwind CSS v4', 'Class-based dark mode via @custom-variant dark'],
      ['Component Kit',   'shadcn (v4)', 'Selected components only; Radix-dependent ones excluded'],
      ['Rich Text',       'TipTap v2', 'StarterKit + Image + Link + Placeholder + TaskList + TaskItem'],
      ['Drag & Drop',     '@dnd-kit (core, sortable, utilities)', 'Kanban board drag-and-drop'],
      ['Toasts',          'Sonner ^2.0.7', 'Global toast notifications'],
      ['Icons',           'Lucide React ^1.7.0', ''],
      ['Storage',         'Railway Storage Buckets (S3-compatible)', 'AWS SDK v3 — presigned URLs for uploads and reads'],
      ['Animations',      'tw-animate-css', 'CSS animation utilities for Tailwind'],
      ['Date Utilities',  'date-fns ^4.1.0', ''],
      ['Testing',         'Vitest ^3.2.4', 'Unit tests; Playwright ^1.59.1 for E2E'],
      ['Deployment',      'Railway (Hobby)', 'CI via GitHub Actions; plain next start (no migrate deploy)'],
    ],
    [Math.round(BODY_W * 0.18), Math.round(BODY_W * 0.28), Math.round(BODY_W * 0.54)],
  ),

  blank(80),
  h2('Key Architectural Notes'),
  bullet('Tailwind CSS v4 dark mode requires @custom-variant dark (&:where(.dark, .dark *)) in globals.css for class-based toggling via next-themes.'),
  bullet('NextAuth v5 uses JWT + Credentials. The PrismaAdapter is intentionally omitted to prevent session.user.id from being undefined.'),
  bullet('Auth config is split into auth.config.ts (Edge-safe) and auth.ts to comply with Next.js middleware constraints — Prisma cannot run in the Edge runtime.'),
  bullet('trustHost: true is set in auth.config.ts for Railway production to prevent redirect loops.'),
  bullet('Local PostgreSQL runs on port 5433 (non-default). Railway\'s internal hostname (postgres.railway.internal) is only reachable within Railway\'s network.'),
  bullet('Production migrations are NOT auto-applied on deploy. The start script is plain next start — migrations must be applied manually with psql before or immediately after pushing.'),
  bullet('@base-ui/react is the UI primitive library (NOT Radix UI). Standard shadcn components that depend on Radix do not exist here.'),

  // ════════════════════════════════════════════════════════════════════════════
  // 4. FEATURES & FUNCTIONAL REQUIREMENTS
  // ════════════════════════════════════════════════════════════════════════════
  h1('4.  Features & Functional Requirements'),

  // 4.1 Authentication
  h2('4.1  Authentication & Account Management'),
  para('Accounts are created manually by an Admin. There is no self-registration or public sign-up flow. The /register route returns a 403 and the register page redirects authenticated users away.'),
  bullet('Login: email + password (bcryptjs hashing). JWT session via NextAuth v5.'),
  bullet('User profile settings: name, email, and password change at /settings.'),
  bullet('Avatar upload: users can upload a profile photo via /api/avatar (multipart POST). The avatar is stored in Railway S3 and proxied through the application to avoid exposing presigned URLs. Session is refreshed after upload to reflect the new avatarUrl.'),
  note('GitHub OAuth login is planned but not yet implemented. Only Credentials login is currently active.'),

  // 4.2 Issue Management
  h2('4.2  Issue Management'),
  para('Issues are the core unit of work in JedForge. Each issue belongs to a project and carries a rich set of fields.'),
  h3('Issue Fields'),
  bullet('Title (required)'),
  bullet('Description — rich text via TipTap v2 (HTML stored in the content field)'),
  bullet('Status — fixed 4-value enum: TODO, IN_PROGRESS, IN_REVIEW, DONE'),
  bullet('Priority — CRITICAL, HIGH, MEDIUM, LOW'),
  bullet('Type — BUG, TASK, STORY, EPIC'),
  bullet('Assignee — single user FK; must hold a ProjectMember row for the project'),
  bullet('Reporter — the user who created the issue (immutable after creation)'),
  bullet('Labels — String[] array on the Issue model; no standalone Label model'),
  bullet('Due Date'),
  bullet('Subtasks — nested issues via parentId FK (self-referential Issue relation)'),
  bullet('Attachments — files uploaded to Railway S3 via presigned URLs'),
  bullet('Comments — rich text via TipTap'),
  bullet('Activity log — system-generated events via ActivityLog model'),
  h3('Issue Keys'),
  para('Issues are assigned sequential keys scoped to their project (e.g. TF-1, TF-2). Keys are globally unique across the application.'),
  h3('Inline Editing'),
  para('Issue fields (status, priority, assignee, labels, due date) can be edited inline from the issue list and board without opening the full detail view.'),
  h3('Activity Log'),
  para('Every field change on an issue is recorded as an ActivityLog entry with action, field, oldValue, newValue, userId, and timestamp. The activity feed is visible on the issue detail view.'),

  // 4.3 Kanban Board
  h2('4.3  Kanban Board'),
  bullet('Issues are displayed as cards within status columns (one column per IssueStatus value).'),
  bullet('Cards can be dragged between columns to update issue status in real time.'),
  bullet('Drag-and-drop is implemented with @dnd-kit (core + sortable packages).'),
  bullet('Optimistic UI updates on drag — the board updates immediately without waiting for the server response.'),
  bullet('Board updates fall back to polling (AutoRefresh component, 3-minute interval) for changes made by other users.'),
  bullet('Board and Column models exist in the schema for a future custom workflow system but are not yet wired to the Kanban renderer.'),

  // 4.4 Comments
  h2('4.4  Comments'),
  bullet('Comments use TipTap v2 rich text (same format as issue descriptions).'),
  bullet('Each comment records authorId, issueId, body (TipTap HTML), createdAt, updatedAt.'),
  bullet('Only the comment author can edit or delete their own comment (enforced in API and UI).'),
  bullet('Comments are visible in the CommentThread component on the issue detail view.'),

  // 4.5 Docs Module
  h2('4.5  Docs Module'),
  para('The Docs module provides per-project collaborative documentation alongside issue tracking. Each project has one DocSpace (lazy-created on first access). DocSpaces contain Sections which contain Pages.'),
  h3('DocSpace'),
  bullet('Lazy-upserted on any authenticated call to the docs API — no pre-creation required.'),
  bullet('isPublic field reserved for a future Phase 5 visibility toggle (all authenticated users can read). Do not repurpose.'),
  h3('Sections'),
  bullet('DocSection groups pages within a DocSpace.'),
  bullet('Sections have a title and a position (display order).'),
  bullet('Pages may be assigned to a section or left at the top level (sectionId: null).'),
  h3('Pages — NATIVE type'),
  bullet('Content is TipTap HTML stored in the content field (same format as issue descriptions, not raw Markdown).'),
  bullet('The TipTap editor supports all StarterKit features plus Image, Link, Placeholder, TaskList, and TaskItem extensions.'),
  bullet('Images within the editor are uploaded to S3 via /api/editor-images (multipart POST) and stored as S3 URLs.'),
  h3('Pages — DOCUMENT type'),
  bullet('Files are uploaded via POST /api/docs/[projectKey]/pages/[pageId]/file (multipart file field; PDF and DOCX only, 50 MB max).'),
  bullet('Uploading a file to an existing NATIVE page converts it to DOCUMENT type.'),
  bullet('GET on the same route returns { url, mimeType, fileName } with a 1-hour presigned S3 URL.'),
  bullet('Files are stored at docs/[docSpaceId]/[pageId]/[uuid]-[sanitized-filename] in S3.'),
  bullet('PDF files render inline via <iframe>; DOCX files prompt a download (no browser-native Word viewer).'),
  bullet('The DELETE handler for a page removes the S3 object automatically. Replacing a file also deletes the previous object.'),
  h3('Version History'),
  bullet('PageRevision rows are snapshot-only — created on save, never mutated.'),
  bullet('The PATCH handler for /api/docs/[projectKey]/pages/[pageId] automatically snapshots previous content into a new PageRevision whenever content is included in the update body.'),
  bullet('Restoring a revision writes its content back to DocPage.content; the auto-snapshot in PATCH captures the pre-restore state.'),
  h3('Issue ↔ Doc Cross-links'),
  bullet('IssueDocLink is the junction table (cascade-deletes when either side is deleted).'),
  bullet('Both issue and page must belong to the same project (enforced in linkDocPage server action).'),
  bullet('Linked docs appear in the RelatedDocsSection panel on the issue detail view.'),
  bullet('Reverse references (issues linked to a page) appear in the referenced-issues-panel on the doc page view.'),
  bullet('Manage links via linkDocPage / unlinkDocPage in actions.ts; read linked issues via GET /api/docs/[projectKey]/pages/[pageId]/links.'),

  // 4.6 Search & Filtering
  h2('4.6  Search & Filtering (FQL)'),
  para('JedForge includes a custom filter query language (FQL — JedForge Filter Query Language) with a recursive descent parser. This must not be referred to as "JQL" in any user-facing copy — use generic descriptive terminology.'),
  h3('Architecture'),
  bullet('Parser: src/lib/query/parser.ts — recursive descent, produces an AST'),
  bullet('Validator: src/lib/query/validator.ts — validates field names and value types against the schema'),
  bullet('Executor: src/lib/query/executor.ts — walks the AST and builds a Prisma where clause'),
  bullet('Test suite: src/lib/query/__tests__/parser.test.ts (Vitest)'),
  h3('Query Bar'),
  bullet('Syntax highlighting in the query input via the QueryBar component.'),
  bullet('Autocomplete for field names, operators, and known values.'),
  bullet('Real-time parse error feedback.'),
  h3('Saved Filters'),
  bullet('Users can save named queries via the SavedFilter model (userId, name, query string, isGlobal flag).'),
  bullet('Global filters (isGlobal: true) are visible to all users in the project.'),
  bullet('Saved filters are surfaced in the SavedFilters component on the issues list.'),

  // 4.7 Notifications
  h2('4.7  Notifications'),
  bullet('In-app notification system — no email notifications currently.'),
  bullet('Four event types: ISSUE_ASSIGNED, COMMENT_ADDED, STATUS_CHANGED, MENTION.'),
  bullet('Notifications are per-user rows in the Notification model (userId, issueId, type, message, read boolean).'),
  bullet('Bell icon in the header (NotificationBell component) shows an unread count badge.'),
  bullet('Clicking the bell opens a dropdown (NotificationDropdown) listing recent notifications.'),
  bullet('Notifications are marked read individually or in bulk.'),

  // 4.8 Real-Time
  h2('4.8  Real-Time Collaboration'),
  note('Full real-time SSE is the target architecture but is NOT yet implemented. The current approach is polling.'),
  h3('Current Implementation — Polling'),
  bullet('AutoRefresh component calls router.refresh() on a 3-minute interval.'),
  bullet('Mounted on the board page and issues list page.'),
  bullet('Changes made by other users are visible after the next poll cycle or on navigation.'),
  h3('Target Implementation — SSE (Planned)'),
  bullet('Issue status changes'),
  bullet('New comments posted'),
  bullet('Issue assignments and reassignments'),
  bullet('Subtask creation and completion'),
  bullet('Activity feed updates'),
  bullet('In-app notification delivery'),

  // 4.9 File Attachments
  h2('4.9  File Attachments'),
  bullet('Issue attachments are uploaded to Railway Storage Buckets (S3-compatible) using AWS SDK v3.'),
  bullet('Upload flow: POST /api/attachments/presign (get presigned URL) → PUT to S3 → POST /api/attachments/confirm (create Attachment row).'),
  bullet('Attachment model stores: fileName, fileKey (S3 key), fileSize, mimeType, uploaderId, issueId.'),
  bullet('Download: GET /api/attachments/[id]/url returns a 1-hour presigned S3 URL.'),
  bullet('Delete: DELETE /api/attachments/[id] removes the S3 object and the database row.'),
  bullet('Attachments are displayed in the AttachmentsPanel component on the issue detail view.'),

  // 4.10 Branding & Theming
  h2('4.10  Branding & Theming'),
  h3('Brand Identity'),
  bullet('Brand colors: #FF6A00 / #F05A28 (orange accent), #1F232B (near-black), #FFFFFF (white).'),
  bullet('Theme color in web manifest: #FF6A00.'),
  bullet('Logo: logo-light.png and logo-dark.png in /public/. Sidebar swaps logos using block dark:hidden / hidden dark:block Tailwind classes.'),
  bullet('Icon: JF monogram in /public/icons/light/ and /public/icons/dark/ at sizes 16px–1024px.'),
  bullet('Favicon: wired in layout.tsx metadata.'),
  h3('Login Page — Ember Particle Effect'),
  bullet('The login page features an animated ember particle effect rendered on an HTML5 canvas.'),
  bullet('Particles drift upward, fade, and respawn — giving a live fire/ember aesthetic matching the JedForge brand.'),
  h3('Theming'),
  bullet('Light, dark, and system themes are supported via next-themes.'),
  bullet('Theme toggle is accessible from the top navigation bar (ThemeToggle component).'),
  bullet('Tailwind dark: variants use class-based toggling (not prefers-color-scheme media queries).'),
  bullet('Dark sidebar is persistent even in light theme — the sidebar uses a fixed dark color palette regardless of theme setting.'),

  // 4.11 Navigation
  h2('4.11  Navigation & UI Structure'),
  bullet('Persistent sidebar across all authenticated views: Dashboard, Search, Projects, and Admin (for Admins only).'),
  bullet('Header bar: breadcrumbs, theme toggle, notification bell, and Create Issue button.'),
  bullet('Within a project, a ProjectNav tab bar provides access to Board, Issues, Docs, Activity, and Settings.'),
  bullet('Global Docs page at /docs shows a cross-project document browser.'),
  bullet('Search page at /search — full FQL query interface with saved filters.'),
  bullet('User settings at /settings — profile, password change, avatar upload.'),

  // 4.12 Project & Admin
  h2('4.12  Project Management & Admin'),
  h3('Project Settings'),
  bullet('Project leads and admins can manage project members from the Settings tab.'),
  bullet('New users can be created and added to the project from settings in one step (createUserAndAddToProject action).'),
  bullet('Projects can be marked as private (invisible to non-members).'),
  bullet('Projects can be archived.'),
  h3('Global Admin Panel'),
  bullet('Admin-only panel at /admin with three sub-views: Users, Projects, Organizations.'),
  bullet('Admins can create, edit, and delete users, projects, and organizations.'),
  bullet('Admin add-user-to-project upserts an OrgMember row then creates ProjectMember — the only bypass of the org-membership pre-check.'),
  bullet('Org deletion is blocked if the org has any projects.'),
  bullet('OrgMember removal is blocked if the user has ProjectMember rows in that org.'),

  // ════════════════════════════════════════════════════════════════════════════
  // 5. DATA MODELS
  // ════════════════════════════════════════════════════════════════════════════
  h1('5.  Data Models'),

  para('The following entities exist in the JedForge Prisma schema. The authoritative definition is prisma/schema.prisma in the repository.'),
  blank(60),

  headerTable(
    ['Model', 'Key Fields', 'Notes'],
    [
      ['User',          'id, name, email, passwordHash, avatarUrl, role (UserRole)', 'Global role: ADMIN | TEAM_MEMBER | VIEWER'],
      ['Organization',  'id, name, slug, plan (Plan), ownerId', 'Multi-tenant container. Plan: FREE | PRO | TEAM'],
      ['OrgMember',     'id, orgId, userId, role (OrgRole)', 'OrgRole: OWNER | ADMIN | MEMBER. Unique (orgId, userId).'],
      ['OrgInvite',     'id, orgId, email, token, role, accepted, expiresAt', 'Email-based invite system (planned)'],
      ['Subscription',  'id, orgId, stripeCustomerId, stripeSubscriptionId, status', 'Stripe integration. Status: TRIALING | ACTIVE | PAST_DUE | CANCELED | INCOMPLETE'],
      ['Project',       'id, name, key (unique), orgId, isPrivate, isArchived', 'Belongs to one Organization'],
      ['ProjectMember', 'id, userId, projectId, role (ProjectMemberRole)', 'Role: PROJECT_LEAD | TEAM_MEMBER | VIEWER. Unique (userId, projectId).'],
      ['Issue',         'id, key (unique), title, description, status, priority, type, assigneeId, reporterId, parentId, position, labels[], dueDate', 'status: IssueStatus enum. priority: IssuePriority enum. type: IssueType enum.'],
      ['Comment',       'id, issueId, authorId, body, createdAt, updatedAt', 'TipTap HTML in body field'],
      ['ActivityLog',   'id, issueId, userId, action, field, oldValue, newValue', 'Append-only audit trail per issue'],
      ['Attachment',    'id, issueId, uploaderId, fileName, fileKey, fileSize, mimeType', 'S3 fileKey; download via presigned URL'],
      ['SavedFilter',   'id, userId, name, query, isGlobal', 'FQL query string; isGlobal shares with all project users'],
      ['Notification',  'id, type (NotificationType), message, userId, issueId, read', 'Types: ISSUE_ASSIGNED | COMMENT_ADDED | STATUS_CHANGED | MENTION'],
      ['Board',         'id, projectId, name', 'Exists for future custom workflow system; not yet wired to Kanban renderer'],
      ['Column',        'id, boardId, name, position, color', 'Child of Board'],
      ['DocSpace',      'id, projectId (unique), isPublic', 'One per project; lazy-upserted on first docs API call'],
      ['DocSection',    'id, docSpaceId, title, position', 'Groups pages within a DocSpace'],
      ['DocPage',       'id, docSpaceId, sectionId, title, type (DocPageType), content, fileKey, fileSize, mimeType, authorId, position', 'Type: NATIVE (TipTap HTML) | DOCUMENT (S3 file)'],
      ['PageRevision',  'id, pageId, content, authorId, createdAt', 'Snapshot-only; auto-created on every PATCH that includes content'],
      ['IssueDocLink',  'id, issueId, pageId, createdById', 'Junction table. Unique (issueId, pageId). Cascade-deletes on either side.'],
    ],
    [Math.round(BODY_W * 0.15), Math.round(BODY_W * 0.30), Math.round(BODY_W * 0.55)],
  ),

  blank(80),
  h2('Key Enums'),
  headerTable(
    ['Enum', 'Values'],
    [
      ['UserRole',          'ADMIN | TEAM_MEMBER | VIEWER'],
      ['OrgRole',           'OWNER | ADMIN | MEMBER'],
      ['ProjectMemberRole', 'PROJECT_LEAD | TEAM_MEMBER | VIEWER'],
      ['IssueStatus',       'TODO | IN_PROGRESS | IN_REVIEW | DONE'],
      ['IssuePriority',     'CRITICAL | HIGH | MEDIUM | LOW  (URGENT accepted as alias for CRITICAL in the v1 API)'],
      ['IssueType',         'BUG | TASK | STORY | EPIC'],
      ['NotificationType',  'ISSUE_ASSIGNED | COMMENT_ADDED | STATUS_CHANGED | MENTION'],
      ['DocPageType',       'NATIVE | DOCUMENT'],
      ['Plan',              'FREE | PRO | TEAM'],
      ['SubscriptionStatus','TRIALING | ACTIVE | PAST_DUE | CANCELED | INCOMPLETE'],
    ],
    [Math.round(BODY_W * 0.25), Math.round(BODY_W * 0.75)],
  ),

  // ════════════════════════════════════════════════════════════════════════════
  // 6. ROLES & PERMISSIONS MATRIX
  // ════════════════════════════════════════════════════════════════════════════
  h1('6.  Roles & Permissions Matrix'),

  h2('Global (Workspace) Roles — UserRole'),
  para('Global roles are assigned at the User level and control access to admin features.'),
  headerTable(
    ['Capability', 'VIEWER', 'TEAM_MEMBER', 'ADMIN'],
    [
      ['View projects (public)',              'Yes', 'Yes', 'Yes'],
      ['View assigned private projects',      'Yes', 'Yes', 'Yes'],
      ['Create issues',                       'No',  'Yes', 'Yes'],
      ['Edit own issues / comments',          'No',  'Yes', 'Yes'],
      ['Access admin panel (/admin)',          'No',  'No',  'Yes'],
      ['Create / delete users',               'No',  'No',  'Yes'],
      ['Create / delete projects',            'No',  'No',  'Yes'],
      ['Mark projects private',               'No',  'No',  'Yes'],
      ['Delete organizations',                'No',  'No',  'Yes'],
    ],
    [
      Math.round(BODY_W * 0.46),
      Math.round(BODY_W * 0.18),
      Math.round(BODY_W * 0.18),
      Math.round(BODY_W * 0.18),
    ],
  ),

  blank(80),
  h2('Organization Roles — OrgRole'),
  para('Org roles control membership management within an organization.'),
  headerTable(
    ['Capability', 'MEMBER', 'ADMIN', 'OWNER'],
    [
      ['View org projects',                   'Yes', 'Yes', 'Yes'],
      ['Invite users to org',                 'No',  'Yes', 'Yes'],
      ['Remove org members',                  'No',  'Yes', 'Yes'],
      ['Delete org',                          'No',  'No',  'Yes'],
    ],
    [
      Math.round(BODY_W * 0.46),
      Math.round(BODY_W * 0.18),
      Math.round(BODY_W * 0.18),
      Math.round(BODY_W * 0.18),
    ],
  ),

  blank(80),
  h2('Project Roles — ProjectMemberRole'),
  para('Project roles are per-project and override or extend the global role for that project context.'),
  headerTable(
    ['Capability', 'VIEWER', 'TEAM_MEMBER', 'PROJECT_LEAD'],
    [
      ['View board and issues',               'Yes', 'Yes', 'Yes'],
      ['View docs',                           'Yes', 'Yes', 'Yes'],
      ['Create / edit issues',                'No',  'Yes', 'Yes'],
      ['Comment on issues',                   'No',  'Yes', 'Yes'],
      ['Edit own comments',                   'No',  'Yes', 'Yes'],
      ['Upload attachments',                  'No',  'Yes', 'Yes'],
      ['Create / edit doc pages',             'No',  'Yes', 'Yes'],
      ['Manage project members (Settings)',    'No',  'No',  'Yes'],
      ['Archive project',                     'No',  'No',  'Yes'],
    ],
    [
      Math.round(BODY_W * 0.46),
      Math.round(BODY_W * 0.18),
      Math.round(BODY_W * 0.18),
      Math.round(BODY_W * 0.18),
    ],
  ),

  blank(80),
  h2('Private Projects'),
  bullet('Projects can be marked private by an Admin.'),
  bullet('A private project is completely invisible to any user not explicitly assigned to it.'),
  bullet('Only Admins can toggle project visibility. Project Leads cannot.'),

  // ════════════════════════════════════════════════════════════════════════════
  // 7. DEPLOYMENT & INFRASTRUCTURE
  // ════════════════════════════════════════════════════════════════════════════
  h1('7.  Deployment & Infrastructure'),

  h2('Hosting'),
  bullet('Platform: Railway (Hobby plan)'),
  bullet('Service name: taskforge (internal), striking-strength (Railway identifier)'),
  bullet('Production URL: https://jedforge.com (managed via IONOS DNS)'),
  bullet('Fallback URL: https://taskforge-production-099b.up.railway.app'),
  bullet('Postgres: Railway-managed PostgreSQL service'),
  bullet('Storage: Railway Storage Buckets (S3-compatible) for attachments, avatars, and doc files'),

  h2('CI / CD'),
  bullet('CI: GitHub Actions on push to main'),
  bullet('Deploy: Railway auto-deploys on CI success (additional ~2–3 minute lag after CI before the new deployment is live)'),
  bullet('Build command: npm ci && npm run build'),
  bullet('Start command: next start (no prisma migrate deploy — migrations are applied manually)'),
  bullet('Prisma Client generation: handled automatically by the @prisma/client postinstall hook during npm ci'),

  h2('Migration Process'),
  bullet('Migration SQL is written manually into prisma/migrations/<timestamp_name>/migration.sql'),
  bullet('schema.prisma is updated in the same commit'),
  bullet('npx prisma generate is run after schema changes'),
  bullet('Production database migration: psql with the DATABASE_PUBLIC_URL Railway variable'),
  bullet('Migrations are NOT auto-applied on deploy — every migration must be applied manually before or immediately after pushing'),

  h2('Environment Variables (key)'),
  headerTable(
    ['Variable', 'Purpose'],
    [
      ['DATABASE_URL',          'Internal Postgres URL for Next.js server (Railway internal network)'],
      ['DATABASE_PUBLIC_URL',   'Public Postgres URL for manual psql commands'],
      ['NEXTAUTH_SECRET',       'NextAuth JWT signing secret'],
      ['NEXTAUTH_URL',          'Canonical application URL (jedforge.com)'],
      ['STORAGE_BUCKET',        'Railway Storage bucket name for S3 operations'],
      ['STORAGE_ENDPOINT',      'S3-compatible endpoint URL for Railway Storage'],
      ['STORAGE_ACCESS_KEY_ID', 'AWS-compatible access key for Railway Storage'],
      ['STORAGE_SECRET_ACCESS_KEY', 'AWS-compatible secret key for Railway Storage'],
    ],
    [Math.round(BODY_W * 0.30), Math.round(BODY_W * 0.70)],
  ),

  h2('Non-Functional Requirements'),
  headerTable(
    ['Requirement', 'Target'],
    [
      ['Team Size',            'Up to 50 members per workspace'],
      ['Response Time',        'Interactive page loads < 2s on Railway Hobby (cold-start excluded)'],
      ['Auth',                 'JWT sessions; no sensitive data in session payload beyond user id, email, name, role'],
      ['Storage',              'S3-compatible; presigned URLs expire in 1 hour for read operations'],
      ['Availability',         'Railway Hobby SLA (~99.5%). No redundancy / failover at this tier.'],
      ['Browser Support',      'Modern Chromium, Firefox, Safari. No IE support.'],
    ],
    [Math.round(BODY_W * 0.25), Math.round(BODY_W * 0.75)],
  ),

  // ════════════════════════════════════════════════════════════════════════════
  // 8. ROADMAP & OPEN DECISIONS
  // ════════════════════════════════════════════════════════════════════════════
  h1('8.  Roadmap & Open Decisions'),

  h2('Planned Features (Not Yet Built)'),
  bullet('GitHub OAuth login'),
  bullet('Real-Time Collaboration (SSE) — replace polling AutoRefresh'),
  bullet('Custom workflow system — wire Board/Column models to the Kanban renderer; Admin-managed statuses'),
  bullet('Sprints & Iterations'),
  bullet('Milestones'),
  bullet('Roadmap / Gantt View'),
  bullet('Dashboard & Analytics'),
  bullet('GitHub Issue Linking'),
  bullet('Webhook Support (Outbound)'),
  bullet('Import / Export (CSV and third-party)'),
  bullet('Mobile App (React Native or PWA)'),
  bullet('Org invite system (OrgInvite model already in schema)'),
  bullet('Subscription billing (Stripe — Subscription model already in schema)'),
  bullet('DocSpace public visibility toggle (isPublic field already in schema)'),
  bullet('Multiple issue assignees'),

  h2('Open Decisions'),
  bullet('AutoRefresh interval: currently 3 minutes. Will be replaced entirely by SSE — no interim change planned.'),
  bullet('Custom workflow architecture: Board/Column models are in the schema but the UI and API integration are not yet designed.'),
  bullet('Label system: currently a String[] on Issue. A standalone Label model with color, per-project scoping, and a junction table may be introduced.'),
  bullet('Subscription tier features: PRO and TEAM plan feature gates are not yet defined.'),

  // ════════════════════════════════════════════════════════════════════════════
  // 9. INTERNAL API (CLAUDE CODE)
  // ════════════════════════════════════════════════════════════════════════════
  h1('9.  Internal v1 REST API'),

  para('An internal REST API for Claude Code to track work in JedForge. No authentication required. This API is not intended for public consumption.'),
  headerTable(
    ['Route', 'Method(s)', 'Purpose'],
    [
      ['/api/v1/issues',                            'GET, POST',          'List or create issues'],
      ['/api/v1/issues/[key]',                      'GET, PATCH, DELETE', 'Read, update, or delete a specific issue by key'],
      ['/api/v1/issues/[key]/comments',             'GET, POST',          'List or post comments on an issue'],
      ['/api/v1/issues/[key]/comments/[commentId]', 'PATCH, DELETE',      'Edit or delete a specific comment'],
      ['/api/v1/projects',                          'GET',                'List projects'],
      ['/api/v1/projects/[id]',                     'GET',                'Read a specific project'],
    ],
    [
      Math.round(BODY_W * 0.38),
      Math.round(BODY_W * 0.20),
      Math.round(BODY_W * 0.42),
    ],
  ),
  blank(60),
  bullet('Base URL (local): http://localhost:3000/api/v1'),
  bullet('Base URL (prod): https://taskforge-production-099b.up.railway.app/api/v1'),
  bullet('Claude Code account: Maximus (maximus@taskforge.dev), userId: cmo365psl000vdrd0p63lirlz'),
  bullet('Use PATCH /api/v1/issues/[key] with statusId to mark an issue done.'),
  bullet('IssueStatus and IssuePriority are enums synthesised in API responses (not DB tables).'),
  bullet('URGENT is accepted as an alias for CRITICAL in priority fields.'),

  // ════════════════════════════════════════════════════════════════════════════
  // 10. DOCUMENT MAINTENANCE
  // ════════════════════════════════════════════════════════════════════════════
  h1('10.  Document Maintenance'),

  para('This document is a living specification. It must be kept current as JedForge evolves. A stale spec is actively harmful — it misleads developers about what is built, what is planned, and what decisions are still open.'),

  h2('Update Triggers'),
  bullet('A new feature is built or scoped — document it in Section 4 and update the data models in Section 5.'),
  bullet('An open decision (Section 8) is resolved — update affected sections and close the decision entry.'),
  bullet('The data model changes — update Section 5.'),
  bullet('The tech stack changes — update Section 3.'),
  bullet('A feature is descoped or cancelled — mark it accordingly rather than deleting it.'),

  h2('How Claude Code Should Use This Document'),
  bullet('At the start of any feature or refactor session — read this document to understand what is built vs. planned.'),
  bullet('It is the authoritative source for naming conventions, data model structure, architectural constraints, and known gotchas.'),
  bullet('Cross-reference with CLAUDE.md for development workflow and environment setup.'),

  blank(200),
  new Paragraph({
    children: [new TextRun({ text: 'End of Document  •  JedForge Functional Specification v2.0', font: FONT, size: pt(9), italics: true, color: 'AAAAAA' })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 0 },
  }),
];

// ── Build & write ─────────────────────────────────────────────────────────────

const doc = new Document({
  numbering: bulletNumbering,
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        },
      },
      children: sections,
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync('.context-docs/JedForge-FunctionalSpec-v2.0.docx', buffer);
console.log('Written: .context-docs/JedForge-FunctionalSpec-v2.0.docx');
