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
- Custom domain: **https://www.jedforge.com** (live, IONOS CNAME → `hyqjbbs6.up.railway.app`)
- Railway fallback URL: https://taskforge-production-099b.up.railway.app
- `NEXTAUTH_URL` = `https://www.jedforge.com`
- **Do NOT hardcode `PORT`** — Railway auto-assigns the port (currently 8080). Hardcoding PORT=3000 causes a port mismatch and 502 errors. The `railway.toml` start command uses `${PORT:-3000}` to pick up Railway's assigned port.
- `railway.toml` exists in the repo root — sets start command (`-H 0.0.0.0` required to bind to all interfaces) and healthcheck path (`/login`, not `/` — auth middleware redirects unauthenticated requests away from `/`)
- `trustHost: true` is required in auth.config.ts (Railway runs behind a reverse proxy)
- Use the public Railway connection string for local Prisma migrations/scripts
- Internal DATABASE_URL (postgres.railway.internal) is only reachable from within Railway
- If the custom domain returns 502 but the railway.app URL works: go to Railway dashboard → Service → Settings → Networking, remove and re-add `www.jedforge.com` to refresh the port routing (IONOS DNS stays unchanged)

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
1. Run `./taskforge-issues.sh "JedForge Enhancements"` to find open issues
2. Implement the fix (start local dev server to test)
3. Commit → push to main → Railway auto-deploys
4. Post a fix-summary comment on the issue in JedForge using the Maximus account (see below)
5. Close the issue via `railway connect postgres`

## JedForge Commenting (Claude Code)
- Claude Code has a dedicated JedForge account: **Maximus** (`maximus@taskforge.dev`, user ID: `cmo365psl000vdrd0p63lirlz`)
- After completing work on an issue, INSERT a comment summarizing the root cause(s) and fix, referencing the commit hash
- Always INSERT — never UPDATE or overwrite existing comments
- Only touch rows where `authorId` = Maximus's ID; never modify Jamie's comments (`cmnhxdr2g0002tmm00mqwhhn7`)
- Insert via: `railway connect postgres` with a raw SQL INSERT into `"Comment"`

## Components — Notable Patterns
- `LabelInput` (`components/issues/LabelInput.tsx`) — tag-style input for labels; type + Enter/comma to add, X to remove, deterministic color per label string. Used in both IssueForm and IssueDetail (auto-saves on change in detail view).
- `KanbanCard` — full card is the drag target (no grip handle); relies on PointerSensor 6px activation distance to allow click-through navigation.

## Current Status
- Phase: 8 (Production Deployment) — COMPLETE
- All phases complete and live on Railway
- App renamed from TaskForge → JedForge (April 2026)
- Custom domain: **www.jedforge.com** — live with SSL (April 2026)
- App is fully functional with real data
- Local dev environment fully configured (Docker + Postgres)

## File Attachments

### Environment Variables (Railway Storage Bucket)
- `RAILWAY_BUCKET_ENDPOINT` — S3-compatible endpoint (e.g. `https://t3.storageapi.dev`)
- `RAILWAY_BUCKET_ACCESS_KEY_ID` — access key for the bucket
- `RAILWAY_BUCKET_SECRET_ACCESS_KEY` — secret key for the bucket
- `RAILWAY_BUCKET_NAME` — bucket name (e.g. `jedforge-attachments-q5zf9y`)
- `RAILWAY_BUCKET_REGION` — region (e.g. `auto` for Tigris)

### Upload Flow
Client POSTs `FormData` (`issueId` + `file`) to `POST /api/attachments/upload`. The server validates, puts the file directly to S3 using the SDK, creates the DB record, logs activity, and returns the attachment with a presigned download URL — all in one request. **Do not use a direct browser → S3 PUT:** Railway's bucket does not return CORS headers, so XHR cross-origin PUTs are blocked by the browser.

Presign/confirm routes (`/api/attachments/presign`, `/api/attachments/confirm`) exist for server-to-server use but are not used by the UI.

### File Limits
- Max size: **20 MB** per file
- Allowed types: everything **except** executable/script extensions: `.exe`, `.bat`, `.cmd`, `.sh`, `.ps1`, `.msi`, `.dll`, `.com`, `.scr`
- Validation uses a blocklist on the file extension (not MIME type) to avoid browser MIME-detection gaps

### Deleting Attachments
- Only the uploader **or** a project OWNER/ADMIN can delete
- `DELETE /api/attachments/[id]` — removes from S3, deletes DB record, logs `"removed_attachment"` activity

### S3 Utility (`lib/s3.ts`)
- `putObject(key, buffer, mimeType)` — server-side upload
- `getPresignedDownloadUrl(key)` — presigned GET URL, valid 1 hour (safe to use in `<img src>` or open in new tab — no CORS issue for reads)
- `getPresignedUploadUrl(key, mimeType, fileSizeBytes)` — presigned PUT, valid 15 min (server-to-server only)
- `deleteObject(key)` — hard delete from S3

### Prisma Model
`Attachment` table with cascade delete when parent issue is deleted. Back-relations added to both `Issue` and `User`. S3 key stored as `fileKey`; always delete the S3 object before deleting the DB record.

## Completed Enhancements (post-launch)
- **Label management** — interactive add/remove labels on issue detail + create/edit form (LabelInput component)
- **Full-card drag-and-drop** — kanban cards draggable from any area, not just the grip handle
- **App rename** — TaskForge → JedForge across all UI, page titles, and package.json (April 2026)
- **Duplicate issue key fix** — `generateIssueKey` used lexicographic sort, causing `TFE-9 > TFE-10`; replaced with JS numeric max + retry-on-conflict logic (TFEN-10)
- **Dashboard greeting** — "Good morning [name] 👋" → "Hi, [name]" (TFEN-8)
- **Board/Issues auto-refresh on creation** — KanbanBoard state now syncs from `initialIssues` via `useEffect` on server refresh; `router.refresh()` called after issue creation (TFEN-7)
- **Periodic auto-refresh** — `AutoRefresh` component calls `router.refresh()` every 3 minutes on Board and Issues pages (TFEN-6)
- **Search type-ahead fixes** — suppressed EOF/unclosed-string parse errors during typing; fixed autocomplete inside partial quoted strings; added labels DB lookup for suggestions (TFEN-9)
- **Search Enter key** — Enter now always executes the search; Tab selects autocomplete suggestions (TFEN-9)
- **Self-service password change** — `/settings` page with current-password verification; accessible from sidebar user menu (TFEN-11)
- **File attachments** — drag-and-drop or file-picker on issue detail; images show thumbnails, other types show file icons; XHR upload with progress bar; delete restricted to uploader or OWNER/ADMIN; Railway S3 bucket (`jedforge-attachments-q5zf9y`)
