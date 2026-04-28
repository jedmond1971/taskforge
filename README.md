# JedForge

A full-stack project management tool inspired by Jira, built as a portfolio project to demonstrate modern full-stack development skills.

## Features

- **Authentication** — Secure sign up / sign in with email and password (NextAuth.js v5)
- **Project Management** — Create and manage multiple projects with unique keys (e.g. TF-1)
- **Issue Tracking** — Full CRUD for issues with status, priority, type, assignee, and labels
- **Kanban Board** — Drag-and-drop board with optimistic UI updates, cross-column moves, and within-column reordering
- **Issue Detail** — Inline editing for all fields, rich description, assignee management
- **Comments** — Add, edit, and delete comments on issues with author-only permissions
- **Activity Feed** — Full audit trail of changes, per-issue and project-wide activity views
- **Filtering & Sorting** — Filter issues by status, priority, type, assignee, and search term
- **Responsive Design** — Mobile-first layout with collapsible sidebar navigation
- **Loading States** — Skeleton screens for all data-fetching pages
- **Toast Notifications** — Real-time feedback for all user actions
- **Error Handling** — Friendly error pages for 404, 403, and unexpected errors

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript (strict mode) |
| Database | PostgreSQL + Prisma ORM |
| Auth | NextAuth.js v5 (JWT) |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Drag & Drop | @dnd-kit/core + @dnd-kit/sortable |
| Notifications | Sonner |
| Date Formatting | date-fns |

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Installation

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd TaskForge
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your database connection string and auth secrets.

4. **Set up the database**
   ```bash
   npx prisma migrate dev --name init
   ```

5. **Seed with demo data**
   ```bash
   npm run db:seed
   ```

6. **Start the development server**
   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Demo Accounts

After seeding, you can log in with:

| Email | Password | Role |
|-------|----------|------|
| admin@taskforge.dev | password123 | Admin |
| member@taskforge.dev | password123 | Member |
| carol@taskforge.dev | password123 | Member |
| dave@taskforge.dev | password123 | Member |

## Screenshots

> _Screenshots coming soon_

<!--
![Dashboard](screenshots/dashboard.png)
![Kanban Board](screenshots/board.png)
![Issue Detail](screenshots/issue-detail.png)
-->

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (dashboard)/        # Authenticated layout group
│   │   ├── page.tsx        # Dashboard home
│   │   └── projects/       # Project pages
│   └── api/                # API routes (auth)
├── components/
│   ├── board/              # Kanban board components
│   ├── comments/           # Comment thread & form
│   ├── activity/           # Activity feed
│   ├── issues/             # Issue list, detail, form
│   ├── layout/             # Sidebar, header
│   └── ui/                 # Reusable UI primitives
├── lib/                    # Utilities, auth config, Prisma client
└── prisma/
    ├── schema.prisma       # Database schema
    └── seed.ts             # Demo data
```

## Built With

This project was built with the assistance of **[Claude Code](https://claude.ai/claude-code)** by Anthropic — an AI-powered CLI for software development.

---

Built by [Your Name] · [Portfolio Link] · [LinkedIn]
