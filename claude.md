# JedForge — Project Intelligence

## What is this?
JedForge is a Jira-inspired project management app built with Next.js 14, PostgreSQL, 
Prisma, and Tailwind CSS. Currently deployed and live on Railway. Being considered as 
a potential indie product/acquisition target — a simpler, more affordable alternative to Jira.
Renamed from TaskForge to JedForge in April 2026 ("TaskForge" name was already in use by another company).

## Tech Stack
- Next.js 14 App Router with Server Components and Server Actions
- PostgreSQL via Prisma ORM (hosted on Railway)
- NextAuth.js v5 for authentication
- Tailwind CSS + shadcn/ui for UI
- @dnd-kit for drag-and-drop
- SSE for real-time activity feed

## Deployment
- Hosted on Railway (app + PostgreSQL), project name: **striking-strength**, service: **taskforge**
- Custom domain TBD — ciphercompass.com being replaced with a new domain (as of 2026-04-20)
- Railway fallback URL: https://taskforge-production-099b.up.railway.app
- `NEXTAUTH_URL` = must be updated in Railway env vars when new domain is configured
- `PORT` = `3000` (must be set — Railway defaults to 8080 which breaks routing)
- `trustHost: true` is required in auth.config.ts (Railway runs behind a reverse proxy)
- Use the public Railway connection string for local Prisma migrations/scripts
- Internal DATABASE_URL (postgres.railway.internal) is only reachable from within Railway

## Railway CLI
- CLI v4.39.0 is installed and linked — use it directly instead of the dashboard
- `railway variables` / `railway variables set KEY=VALUE` — manage env vars
- `railway logs` — tail live logs
- `railway redeploy` — redeploy latest build
- `railway status` — confirm linked project/service

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

## Local Development
- Postgres runs in Docker container `taskforge-db` on port 5433 (matches `.env`)
- To start a dev session: `docker start taskforge-db && npm run dev`
- Seed users: admin@taskforge.dev, member@taskforge.dev, carol@taskforge.dev, dave@taskforge.dev (password: see seed file — legacy emails, not user-facing)
- Do NOT run `prisma/seed.ts` against production — it wipes all data first
- Always test UI changes locally before pushing to production

## Scripts
- `scripts/create-user.ts` — one-off user creation script (safe, idempotent)
  Usage: DATABASE_URL="..." ADMIN_EMAIL="..." ADMIN_PASSWORD="..." ADMIN_NAME="..." npx tsx scripts/create-user.ts
- `taskforge-issues.sh` — lists open issues from production DB via `railway connect postgres`
  Usage: `./taskforge-issues.sh` (all open) or `./taskforge-issues.sh "JedForge Enhancements" IN_PROGRESS`
- To close an issue: `echo "UPDATE \"Issue\" SET status = 'DONE' WHERE id = '<id>';" | railway connect postgres`

## Issue Workflow
1. Run `./taskforge-issues.sh` to find the highest-priority open issue
2. Implement the fix (start local dev server to test)
3. Commit → push to main → Railway auto-deploys
4. Close the issue via `railway connect postgres`

## Components — Notable Patterns
- `LabelInput` (`components/issues/LabelInput.tsx`) — tag-style input for labels; type + Enter/comma to add, X to remove, deterministic color per label string. Used in both IssueForm and IssueDetail (auto-saves on change in detail view).
- `KanbanCard` — full card is the drag target (no grip handle); relies on PointerSensor 6px activation distance to allow click-through navigation.

## Current Status
- Phase: 8 (Production Deployment) — COMPLETE
- All phases complete and live on Railway
- App renamed from TaskForge → JedForge (April 2026)
- Custom domain change pending (ciphercompass.com → TBD)
- App is fully functional with real data
- Local dev environment fully configured (Docker + Postgres)

## Completed Enhancements (post-launch)
- **Label management** — interactive add/remove labels on issue detail + create/edit form (LabelInput component)
- **Full-card drag-and-drop** — kanban cards draggable from any area, not just the grip handle
