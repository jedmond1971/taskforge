# TaskForge — Project Intelligence

## What is this?
TaskForge is a Jira-clone portfolio project built with Next.js 14, PostgreSQL, Prisma, and Tailwind CSS.

## Tech Stack
- Next.js 14 App Router with Server Components and Server Actions
- PostgreSQL via Prisma ORM
- NextAuth.js for authentication
- Tailwind CSS + shadcn/ui for UI
- @dnd-kit for drag-and-drop
- SSE for real-time activity feed

## Conventions
- All database queries go through Prisma client in `src/lib/prisma.ts`
- Use Server Actions for mutations where possible, API routes for streaming/complex ops
- Issue keys follow the pattern `{PROJECT_KEY}-{incrementing_number}` (e.g., TF-42)
- Components are organized by domain: `board/`, `issues/`, `comments/`, `activity/`, `layout/`
- Use shadcn/ui primitives from `components/ui/` — do not create custom base components
- All pages use the (dashboard) layout group which provides sidebar + header
- TypeScript strict mode is enabled — no `any` types

## Subagent Routing Rules
**Parallel dispatch** (ALL conditions must be met):
- 3+ unrelated tasks or independent domains
- No shared state between tasks
- Clear file boundaries with no overlap

**Sequential dispatch** (ANY condition triggers):
- Tasks have dependencies (B needs output from A)
- Shared files or state (merge conflict risk)
- Unclear scope (need to understand before proceeding)

## Current Status
- Phase: 1 (Foundation)
- Completed: nothing yet
- In progress: initial setup
