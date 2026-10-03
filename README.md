# JedForge

**Project tracking your team will actually enjoy using — with docs built in, and an AI assistant that can work *inside* your projects.**

JedForge is a multi-tenant project management platform: issue tracking, Kanban boards, sprints, a built-in documentation space, and a powerful search language — all in one fast, dark-mode-friendly app. Each client organization experiences JedForge as its own private instance.

Live at [www.jedforge.com](https://www.jedforge.com).

---

## Why JedForge?

Most project tools make you choose: a simple board that runs out of steam, or a heavyweight system that needs an admin to tame it. JedForge aims for the middle — simple on day one, deep when you need it — and adds a few things you won't find in most trackers.

### What makes it different

| | |
|---|---|
| **Connect Claude (or any MCP-compatible AI) directly to your projects** | JedForge is a ready-made [Model Context Protocol](https://modelcontextprotocol.io) server with a full OAuth 2.1 sign-in flow. Add it as a connector in Claude.ai and you can say *"create a bug for the login timeout, link it to the auth epic, and write up the fix in our docs"* — and it happens, using your own permissions. Search issues, create and update them, comment, link and re-parent issues, and read or write documentation pages, all from a chat. |
| **Docs and issues live together** | Every project gets its own documentation space with a rich editor, page versions, and the ability to upload and preview real documents (PDF, Word). Link docs to the issues they relate to, and see right on an issue which pages mention it. No second tool, no copy-pasted links that rot. |
| **A real query language, not just filter dropdowns** | Type `status = "In Progress" AND assignee = currentUser() ORDER BY updatedAt DESC` and get exactly that. Combine conditions with `AND` / `OR` / `NOT`, group with parentheses, use `IN` lists, and save the result as a reusable filter for yourself or the whole team. |
| **Pick your workflow: Kanban *or* Sprints** | Choose the style per project when you create it. Kanban projects get a continuous board; Sprint projects get a Backlog and a board focused on only the active sprint — with unfinished work automatically returned to the backlog when the sprint completes. |
| **Fine-grained permissions without the pain** | Simple roles cover most teams. When someone needs a bit more — say, the ability to run sprints or manage API keys — add them to a **Group** that boosts specific permissions. Groups can only *add* abilities where a person is already a member; they never quietly open up access to projects someone shouldn't see. |
| **Built to be integrated** | A customer-facing REST API with org-scoped API keys, plus the MCP connector above, means JedForge fits into your tooling instead of fencing you in. |
| **Security as a feature, not an afterthought** | Strict tenant isolation, sanitized rich text, hardened uploads, durable rate limiting, revocable credentials, an audit log for admin actions, structured security logging with owner alerting, and CI that blocks on secret leaks and vulnerable dependencies. See [Security](#security). |

---

## What you can do

### Track work your way
- **Issues with real structure** — types (Bug, Task, Story, Epic), priority, assignee, labels, due dates, rich-text descriptions, and file attachments.
- **Parent / child hierarchy** — organize work under Epics, browse it in a dedicated **Hierarchy** view, and link existing issues as parents or children in a couple of clicks.
- **Issue links** — mark issues as *blocks* or *relates to* each other so dependencies are visible where people are looking.
- **Custom workflow statuses** — each project defines its own columns/statuses, grouped into To Do / In Progress / Done categories so reporting still makes sense.
- **Custom fields** — add Text, Number, Date, Checkbox, Single-select and Multi-select fields at the organization level, share them across projects, and drag to reorder how they appear on each project's issues.
- **Bulk Edit** — a dedicated page for changing status, priority, assignee and more across many issues at once.

### See and steer the work
- **Kanban board** — drag-and-drop with instant (optimistic) updates, moves between columns, and reordering within a column.
- **Sprints & Backlog** — plan, start and complete sprints; one active sprint at a time keeps everyone focused.
- **Dashboard** — your assigned issues, upcoming due dates and recent activity across all your active projects.
- **Activity feed** — a full audit trail of changes, per issue and project-wide.
- **Notifications** — an in-app bell for assignments, status changes and comments.
- **Keyboard-friendly** — press `/` anywhere to jump to search, `N` inside a project to create an issue.

### Find anything
- **Query search** across status, priority, type, assignee, reporter, project, title, description, labels, key, and created/updated dates.
- **Saved filters** — personal ones, plus team-wide filters promoted by an admin.
- **Always safe** — every search is automatically restricted to projects you're a member of, no matter what you type.

### Write and share knowledge (Docs)
- **Per-project doc spaces** with sections, drag-and-drop page ordering, and a rich-text editor (headings, lists, task lists, images, code and more).
- **Upload documents** — drop in PDFs and Word files; PDFs preview inline and `.docx` files are rendered right in the app.
- **Version history** — every save is snapshotted so you can see and restore earlier versions.
- **Page status** — mark pages Draft, In Review or Published; a table-of-contents rail and "recently viewed" list make long docs easy to navigate.
- **Link to issues** — connect pages and issues in both directions.
- **Optional public spaces** — make a doc space readable by everyone in your organization, not just project members.

### Work as a team
- **Organizations** — each client organization sees only its own projects, people and data.
- **Invites by email** — bring teammates in with invitation emails.
- **Roles** — organization roles (Owner, Admin, Member) and per-project roles (Project Lead, Team Member, Viewer).
- **Groups** — optional, additive permission boosts (see above).
- **Closed projects** — admins can close a finished project: it becomes read-only and drops out of day-to-day views, but stays available for reference.
- **Admin panel** — manage organizations, users, projects and invites, review an admin audit log, and see alerting status.
- **Profile & settings** — avatar, display name, password changes (which also sign out your other sessions), and light / dark theme.

### Bring in AI
- **Claude connector (MCP)** — use JedForge from Claude.ai, as described above.
- **In-app AI chat** — an assistant panel on each issue that can act on your project through the same tools. *This is an owner-only feature gated by the `AI_CHAT_ENABLED` flag and is off by default.*

### Integrate
- **External REST API** at `/api/external/v1/` — list projects, read and create issues, and post comments, authenticated with org-scoped API keys that admins create and revoke under **Org Settings**. New issues and comments are attributed to the key's creator, so nobody can impersonate someone else.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript (strict) |
| Database | PostgreSQL + Prisma 5 |
| Auth | NextAuth.js v5 (JWT sessions) + a custom OAuth 2.1 server for MCP |
| UI | Tailwind CSS v4, Base UI (`@base-ui/react`), TipTap v3 rich-text editor |
| Drag & drop | dnd-kit |
| File storage | S3-compatible object storage (Railway Buckets) |
| Email | Resend + React Email |
| AI | Anthropic SDK, Model Context Protocol SDK |
| Testing | Vitest (unit + DB-backed cross-tenant integration suite), Playwright |
| CI / hosting | GitHub Actions → Railway |

---

## Architecture notes

- **Server Actions for the app, REST for integrations.** Dashboard mutations are Next.js Server Actions. REST surfaces exist for integrations: an external API (org API keys), the MCP server and OAuth endpoints, and an internal tracking API.
- **Tenancy is enforced in code and in tests.** Every project belongs to exactly one organization, and every user–project relationship is validated within that organization. A dedicated integration suite exercises cross-tenant access against a real database, and an authorization matrix documents the access rule for every route and server action.
- **Roles plus additive Groups.** Permission checks go through shared guards in `src/lib/permissions.ts`; group grants are computed automatically and can only boost, never create, access.
- **Query language.** `src/lib/query/` contains a hand-written recursive-descent parser that produces an AST, which the executor turns into a Prisma `where` clause — always combined with a membership filter.
- **Sprint vs. Kanban** is chosen at project creation and locked afterward; the one-active-sprint rule is enforced by a database constraint, not just app logic.

More detail lives in [`.context-docs/`](.context-docs/) (design notes per feature) and in the functional specification, `.context-docs/JedForge-FunctionalSpec-v2.0.docx`.

---

## Security

JedForge is built for multiple client organizations sharing one deployment, so isolation and hardening are core features:

- **Tenant isolation** — verified by a database-backed cross-tenant test suite that runs in CI.
- **Input safety** — rich text is sanitized server-side before it is stored, backed by a standing XSS test corpus; uploads are raster-image/PDF-validated by content, and downloads are never rendered inline unless known safe.
- **Credential hygiene** — API keys and OAuth tokens are stored as hashes, OAuth refresh tokens rotate (reuse revokes the whole token family), and password or role changes invalidate existing sessions and revoke API/OAuth credentials.
- **Abuse protection** — durable, database-backed rate limiting on sensitive endpoints; kill switches to disable the MCP/OAuth, uploads and external API surfaces instantly.
- **Observability** — structured security events, log redaction so sensitive data never reaches logs, and optional email alerting to the deployment owner.
- **Supply chain & release controls** — `main` is protected; every change goes through a PR that must pass lint/type-check/tests, cross-tenant integration tests, secret scanning (gitleaks) and a dependency-audit gate.

---

## Getting started (local development)

### Prerequisites
- Node.js 20+
- PostgreSQL 14+ (the project's local setup uses Docker Postgres on port 5433)

### Setup

```bash
git clone https://github.com/jedmond1971/taskforge.git
cd taskforge
npm install
cp .env.example .env      # then edit DATABASE_URL and the auth secrets
npx prisma migrate dev    # create the schema
npm run db:seed           # load demo data
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Demo accounts

After seeding, sign in with any of these (password `password123`):

| Email | Role |
|-------|------|
| `admin@jedforge.dev` | Platform admin |
| `member@jedforge.dev` | Member |
| `carol@jedforge.dev` | Member |
| `dave@jedforge.dev` | Member |

The seed data includes three sample projects: **PL** (Product Launch), **MA** (Mobile App) and **WR** (Website Redesign). The seed script is guarded against running on a non-local database.

### Useful commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the dev server |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type-check |
| `npm test` | Unit tests (Vitest) |
| `npm run test:integration` | DB-backed cross-tenant integration tests (needs the local database) |
| `npm run security:audit` | Dependency audit gate |
| `npm run db:studio` | Browse the database with Prisma Studio |

---

## Configuration

Copy `.env.example` to `.env`. The essentials:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_URL` | Public URL of the deployment (e.g. `https://www.jedforge.com`) |
| `NEXTAUTH_SECRET` / `AUTH_SECRET` | Same random secret in both (`openssl rand -base64 32`) |

Optional features:

| Variable(s) | Enables |
|-------------|---------|
| `RAILWAY_BUCKET_ENDPOINT`, `RAILWAY_BUCKET_ACCESS_KEY_ID`, `RAILWAY_BUCKET_SECRET_ACCESS_KEY`, `RAILWAY_BUCKET_NAME`, `RAILWAY_BUCKET_REGION` | File attachments, doc uploads and avatars (S3-compatible storage) |
| `RESEND_API_KEY` | Invitation and alert emails |
| `V1_API_KEY` | Internal tracking API (`/api/v1`) shared secret |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AI_CHAT_ENABLED` | In-app AI chat (off unless `AI_CHAT_ENABLED=true`) |
| `ALERTING_ENABLED`, `ALERT_EMAIL_TO` | Owner security alerting |
| `OAUTH_MCP_ENABLED`, `UPLOADS_ENABLED`, `EXTERNAL_API_ENABLED` | Kill switches (default on; set `false` to disable a surface) |

Never commit real secrets.

---

## Deployment (Railway)

JedForge deploys to [Railway](https://railway.app). `railway.toml` sets the start command and health check, and runs `npx prisma migrate deploy` before every deploy so database migrations apply automatically.

1. Create a Railway project with a **PostgreSQL** service and a **Web** service pointed at this repo.
2. Set the environment variables above in the Railway dashboard.
3. Deploys happen automatically when a pull request is merged to `main` and CI passes.

---

## Contributing / workflow

`main` is protected: direct pushes are rejected. Work on a branch, open a pull request, and make sure these pass before merging:

```bash
npm run lint
npx tsc --noEmit
npm test
```

CI additionally runs the cross-tenant integration suite, secret scanning and the dependency-audit gate. Project conventions and hard-won gotchas are documented in [`CLAUDE.md`](CLAUDE.md).

---

## Project structure

```
src/
├── app/
│   ├── (auth)/            # login, register, invite, OAuth consent
│   ├── (dashboard)/       # authenticated app: dashboard, projects, search, docs,
│   │                      #   notifications, org-settings, profile, settings, admin
│   └── api/               # REST + integration surfaces: external API, MCP, OAuth,
│                          #   attachments, docs, AI, internal v1
├── components/            # board, issues, projects, docs, comments, activity,
│                          #   notifications, query, layout, ui
├── emails/                # React Email templates
├── lib/                   # permissions, query language, MCP server, OAuth,
│                          #   rate limiting, security events, alerting, storage, ...
└── integration/           # DB-backed cross-tenant integration tests
prisma/
├── schema.prisma
└── seed.ts
.context-docs/             # feature design notes and the functional specification
```

---

## Built with Claude Code

JedForge is developed with the assistance of **[Claude Code](https://claude.ai/claude-code)** by Anthropic.
