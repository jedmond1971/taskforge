# JedForge Dark-Mode UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved warm-charcoal/rust dark-mode visual redesign (shell, dashboard, kanban board, issue detail, docs module) across JedForge without changing any server action, permission check, tenant boundary, or workflow — then port the same tokens to light mode.

**Architecture:** A shared design-token layer (`src/app/globals.css` `@theme inline` + `:root`/`.dark`) plus a small set of shared presentational primitives (`PageHeader`, `SurfacePanel` extending the existing `card.tsx`, `StatusChip`/`MetaChip` extending the existing `badge.tsx`, `MetricCard`, `EmptyState`, `PropertyRow`, `MonoMeta`) are built once, then applied screen-by-screen in the order the data risk is lowest: bug fix → foundation → dashboard → board → issue detail → docs → empty-state consolidation → light mode. Every screen task is a pure visual/structural refactor over existing Prisma queries and server actions — no schema migration is in scope for this plan.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS 4 (`@theme inline`, no separate config needed), Base UI, `class-variance-authority` + `cn()`, Lucide icons, TipTap, `@dnd-kit/core`+`@dnd-kit/sortable`, Sonner.

**Spec:** `Claude Code Handoff.md` (implementation brief) and `jedforge-ui-mockups.html` (pixel/CSS reference — open it side-by-side while styling; its class names and CSS custom properties are the literal source of truth for spacing/radius/color) — both at the repo root. Acceptance criteria per screen are cross-referenced against the live JFR issues below.

| Issue | Title | Priority | Maps to task |
|---|---|---|---|
| JFR-151 | Fix: raw HTML tags rendered in activity feed | MEDIUM | Task 1 |
| JFR-145 | Establish redesign design tokens (CSS variables) | CRITICAL | Task 2 |
| JFR-146 | Implement dashboard redesign (dark mode) | HIGH | Task 3 |
| JFR-147 | Implement kanban board redesign (dark mode) | HIGH | Task 4 |
| JFR-148 | Implement issue detail redesign (dark mode) | HIGH | Task 5 |
| JFR-149 | Implement Docs home + document reader redesign (dark mode) | HIGH | Task 6 |
| JFR-150 | Redesign empty states across the app | MEDIUM | Task 7 |
| JFR-152 | Port UI redesign to light mode | LOW | Task 8 |
| JFR-144 | Dark-mode UI redesign implementation (epic) | HIGH | Tracking only — close once Tasks 1–8 ship |

## Decisions and scope gaps found while planning

These were discovered cross-checking the handoff against the actual JFR issues and codebase, and need your call before or during execution:

1. **No tracked issue covers the app-shell restyle.** The handoff's Phase 1 bundles "tokens + fonts + shared components + sidebar/header restyle" into one phase, but JFR-145's own description only mentions CSS tokens. Task 2 below still does the full Phase-1 scope (shell included) because splitting shell work into its own PR later would mean restyling `Sidebar.tsx`/`Header.tsx` twice. Recommend filing a JFR issue for the shell work (or re-scoping JFR-145's description) before starting Task 2 — flagging rather than silently creating one on your tracker.
2. **JFR-147 asks for enforced WIP limits ("In Progress 4/6"); the handoff's own data rule says defer them** because no schema field exists for a per-column limit — adding one is a migration + settings-UI decision, not a visual refresh. Task 4 below follows the handoff's data rule: ships a plain issue-count badge per column (no limit, no red "over WIP" state) and calls this out explicitly at review time rather than inventing a limit value. If you want real configurable WIP limits, that's a separate schema-backed feature — say so and I'll scope it as its own plan.
3. **JFR-142 ("allow board columns to contain multiple statuses") is excluded from this plan.** It's a genuine data-model change (today a column is exactly one `ProjectStatus`), not a visual refresh, and the handoff explicitly says a schema/workflow change like this needs a separate product decision. Not touched by Tasks 1–8.
4. **JFR-143 (sidebar cut off on mobile) is folded into Task 2**, not planned separately — it's the same `Sidebar.tsx` file already being rebuilt for the shell restyle, and the root cause (missing `overflow-y-auto`/`min-h-0` on the nav flex child) is a one-line fix alongside that work.
5. **`jedforge_icons_light_dark/`, `design_handoff_docs_module/`, and `Jedforge docs module UI mockups.zip`** (untracked in the repo, dated Sep 8) are a *different, earlier* docs-module design pass, not part of today's `Claude Code Handoff.md` scope. Not used by this plan. `jedforge-wordmark.svg` (repo root, Apr 22) *is* reused — see Task 2.
6. **The handoff's own "Phase 6 — System rollout"** (applying the same primitives to Projects, issue list, hierarchy, backlog, search, notifications, settings, admin, loading/error/not-found/access-denied screens) has no corresponding JFR issue yet and is explicitly gated by the handoff itself on the four approved areas shipping first ("Once the four approved areas are accepted..."). Not planned here — file it as its own issue/plan once Tasks 1–8 are accepted, rather than scope-creeping it into this pass.

## Global Constraints

*(verbatim from the handoff's "Non-negotiable implementation rules," binding on every task below)*

- Preserve all existing server actions, authorization checks, tenant boundaries, closed-project behavior, drag-and-drop behavior, editor behavior, and error handling.
- Keep Next.js, React, Tailwind CSS 4, Base UI, Lucide, TipTap, and the existing shadcn-style primitives — do not introduce a second component library.
- Use real database-backed values only. If the mockup shows data the schema can't supply (chart series, WIP limits, pinned docs, doc-completion %), omit or defer it — never hard-code mockup sample data.
- Retain the current theme toggle (`next-themes`, class-based `.dark`) and its persistence. Never force dark mode.
- Touch targets ≥ 44×44px where practical; visible keyboard focus; semantic labels; existing ARIA behavior preserved.
- One phase per commit/PR — do not combine redesign work with unrelated refactoring.
- Per this repo's `CLAUDE.md`: run `npm run lint`, `npx tsc --noEmit`, `npm test`, and `npm run build` before every commit; verify `git diff --name-only --cached` only contains files you meant to touch; `main` is protected — branch, PR, `gh pr checks --watch`, squash-merge.
- `sanitizeTipTapHtml()` / `rich-text-sinks.test.ts` (SECH-106) still gate every Prisma write of `description`/`body`/`content` — this plan touches *display* of already-sanitized values only (Task 1), never adds a new persistence path.

## Review Focus

Five things the spec implies but no single task's acceptance check directly exercises — verify these explicitly during/after the relevant task:

1. **`stripHtml` truncation on a very long rich-text `oldValue`/`newValue`** (Task 1) — a multi-paragraph description edit must not render a wall of text in the activity feed or blow out the row height; confirm the truncation length reads sensibly against real seeded long-description data, not just short test strings.
2. **Closed-project read-only state survives the issue-detail and docs restyles** (Tasks 5, 6) — `requireProjectRole`/`isDocsWriteLocked()` gate writes at the session layer per `.context-docs/closed-projects.md`; a purely visual properties-rail/workbar refactor must not accidentally re-expose an edit control on a closed project by, e.g., defaulting a new `PropertyRow` to editable.
3. **Group-grant-based permissions on the "Create Issue" / doc-create / delete-issue actions** (Tasks 2, 3, 5, 6) — several of these call `canX(role, grants)` directly rather than through `require*Role` (JFR-121 Phase 2); a restyle that moves a button's JSX location must keep the same `canX(...)` check guarding it, not a hard-coded role list.
4. **AI chat panel responsive collapse at exactly the `xl` breakpoint** (Task 5) — the handoff requires "no three-column squeeze"; verify the properties rail doesn't get squeezed to unreadable width in the ~1024–1279px band where the chat panel is enabled but hasn't yet stacked.
5. **Kanban drag-and-drop rollback on a simulated server-action failure** (Task 4) — restyled cards must not lose the existing optimistic-update-then-rollback behavior (`moveIssue`/`reorderIssues` failure path); this only shows up if you actually force a failure (e.g. temporarily throw in the action) since the happy path looks identical whether rollback works or not.

---

## File Structure

| Area | Files |
|---|---|
| Bug fix | Create `src/lib/text.ts`; modify `src/components/activity/ActivityFeed.tsx`, `src/app/api/ai/chat/route.ts` |
| Tokens + shell | Modify `src/app/globals.css`; modify `src/components/layout/Sidebar.tsx`, `Header.tsx`, `DashboardShell.tsx`; modify `src/components/ui/card.tsx`, `badge.tsx`; create `src/components/ui/page-header.tsx`, `metric-card.tsx`, `property-row.tsx`, `mono-meta.tsx`, `empty-state.tsx` |
| Dashboard | Modify `src/app/(dashboard)/page.tsx` |
| Board | Modify `src/components/board/KanbanBoard.tsx`, `KanbanColumn.tsx`, `KanbanCard.tsx` |
| Issue detail | Modify `src/components/issues/IssueDetail.tsx` |
| Docs | Modify `src/app/(dashboard)/projects/[projectKey]/docs/page.tsx`, `[pageId]/page.tsx`; modify `src/components/docs/doc-page-editor.tsx`, `doc-document-view.tsx`, `docs-list-body.tsx`, `recently-viewed-docs.tsx`, `doc-toc-rail.tsx`; create `src/components/docs/doc-workbar.tsx` |
| Empty states | Modify `src/app/(dashboard)/notifications/page.tsx`, `projects/closed/page.tsx`, `(dashboard)/page.tsx`, `src/components/board/KanbanColumn.tsx`, `src/components/issues/RelatedDocsSection.tsx`, `src/components/query/SavedFilters.tsx`, `src/components/query/QueryResults.tsx`, `docs-list-body.tsx` |
| Light mode | Modify `src/app/globals.css` (`:root` only); replace `public/logo-light.png` usage |

No new tables, migrations, or server actions anywhere in this plan.

---

### Task 1: Fix raw HTML in the activity feed (JFR-151)

**Files:**
- Create: `src/lib/text.ts`
- Modify: `src/components/activity/ActivityFeed.tsx:1-44`
- Modify: `src/app/api/ai/chat/route.ts:13-18, 118` (dedupe the existing private `stripHtml`)

**Interfaces:**
- Produces: `stripHtml(html: string): string` and `truncateText(text: string, max: number): string`, both exported from `src/lib/text.ts`, consumed by `ActivityFeed.tsx` and `route.ts`.

This is a real, narrowly-scoped bug fix (confirmed in the running code — see below), independent of the visual redesign, so it ships first and stops the redesign screens from inheriting the bug.

- [ ] **Step 1: Confirm the bug exists**

Run:
```bash
grep -n "const from = entry.oldValue" src/components/activity/ActivityFeed.tsx
```
Expected: matches line 27 — confirms `oldValue`/`newValue` are interpolated as raw strings with no stripping, so a rich-text field's stored HTML (e.g. `<p>New text</p>`) renders literally.

- [ ] **Step 2: Create the shared text helper**

Create `src/lib/text.ts`:
```typescript
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}
```

- [ ] **Step 3: Use it in `ActivityFeed.tsx`**

Add the import:
```typescript
import { stripHtml, truncateText } from "@/lib/text";
```

Replace lines 27–28:
```typescript
    const from = entry.oldValue ?? "–";
    const to = entry.newValue ?? "–";
```
with:
```typescript
    const from = entry.oldValue ? truncateText(stripHtml(entry.oldValue), 60) : "–";
    const to = entry.newValue ? truncateText(stripHtml(entry.newValue), 60) : "–";
```

- [ ] **Step 4: Dedupe the AI-chat copy of `stripHtml`**

In `src/app/api/ai/chat/route.ts`, delete the local `function stripHtml(html: string): string { ... }` (lines 13–18) and add `import { stripHtml } from "@/lib/text";` near the top with the other imports. Leave line 118's call site (`stripHtml(issue.description)`) unchanged — it now resolves to the shared import.

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```
Open an issue whose description you've edited at least once (any seeded issue works), check its Activity tab / the dashboard's Recent Activity panel, and confirm the "changed description from … to …" line shows plain readable text, not `<p>` tags. Then edit a short field like Priority and confirm short values still display in full (not truncated at 60 chars when they're well under it).

- [ ] **Step 6: Run gates and commit**

```bash
npm run lint && npx tsc --noEmit && npm test
git add src/lib/text.ts src/components/activity/ActivityFeed.tsx src/app/api/ai/chat/route.ts
git commit -m "fix(activity): strip HTML from activity feed field diffs (JFR-151)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Design tokens + app shell (JFR-145, folds in JFR-143)

**Files:**
- Modify: `src/app/globals.css` (`:root` lines 122–190ish and `.dark` block — exact ranges shift after Task 1; re-grep before editing)
- Modify: `src/components/layout/Sidebar.tsx`, `Header.tsx`, `DashboardShell.tsx`
- Modify: `src/components/ui/card.tsx` (extend, don't replace, for `SurfacePanel`-style usage)
- Modify: `src/components/ui/badge.tsx` (add `StatusChip`/`MetaChip` cva variants)
- Create: `src/components/ui/page-header.tsx`, `metric-card.tsx`, `property-row.tsx`, `mono-meta.tsx`, `empty-state.tsx`

**Interfaces:**
- Consumes: `jedforge-ui-mockups.html`'s `:root`/`@media (prefers-color-scheme: dark)` blocks (lines 14–102) as the literal token source.
- Produces: new CSS custom properties (`--sidebar-raised`, `--surface`, `--surface-raised`, `--surface-active`, `--border-soft`, `--primary-soft`, `--warning`, `--warning-soft`, `--info`, `--info-soft`, `--success`, `--success-soft`, `--danger`, `--danger-soft`, `--teal`, `--teal-soft`, `--shadow-panel`, `--shadow-overlay`) available app-wide via Tailwind arbitrary-value/`@theme inline` mapping; `PageHeader`, `SurfacePanel` (via `card.tsx`), `StatusChip`, `MetaChip`, `MetricCard`, `PropertyRow`, `MonoMeta`, `EmptyState` component APIs consumed by every later task.

This is the highest-leverage task — every other screen task depends on the components and tokens produced here. Do it as one PR per the handoff's "commit this separately" rule.

- [ ] **Step 1: Add IBM Plex fonts via `next/font`**

In `src/app/layout.tsx`, add (alongside whatever font loading already exists there — check first with `grep -n "next/font" src/app/layout.tsx`):
```typescript
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-mono",
  display: "swap",
});
```
Apply both variable classes to the root `<html>`/`<body>` className alongside existing classes. Do **not** add a `<link>` to Google Fonts in any component — the mockup's `<link href="fonts.googleapis.com...">` is for the standalone mockup file only; the product must use the Next.js font strategy per the handoff's non-negotiable rule.

- [ ] **Step 2: Add the new semantic tokens to `globals.css`**

Re-check current line numbers first (`grep -n "^\.dark {" src/app/globals.css` and `grep -n "^:root {" src/app/globals.css`), then inside the existing `.dark { ... }` block add (do not remove any existing `--sidebar*`/`--primary`/etc. tokens — this is additive):
```css
  --sidebar-raised: #191918;
  --surface: #1d1d1b;
  --surface-raised: #252522;
  --surface-active: #2d2c29;
  --border-soft: #2c2b27;
  --primary-soft: #46291f;
  --warning: #e0a63c;
  --warning-soft: #3d321c;
  --info: #79a8d5;
  --info-soft: #233547;
  --success: #86b37e;
  --success-soft: #293a27;
  --danger: #df7f77;
  --danger-soft: #442724;
  --teal: #58a89d;
  --teal-soft: #1f3935;
  --shadow-panel: 0 1px 1px rgb(0 0 0 / 35%), 0 10px 30px rgb(0 0 0 / 22%);
  --shadow-overlay: 0 18px 50px rgb(0 0 0 / 50%);
```
Inside `:root` (light mode), add placeholder mappings for the same variable names using the existing light-mode surface colors so nothing is `undefined` before Task 8 does the real light-mode pass:
```css
  --sidebar-raised: var(--sidebar);
  --surface: var(--card);
  --surface-raised: var(--secondary);
  --surface-active: var(--secondary);
  --border-soft: var(--border);
  --primary-soft: var(--secondary);
  --warning: #b87a12;
  --warning-soft: #f3e3bb;
  --info: #3f6f9f;
  --info-soft: #d8e4ee;
  --success: #56824f;
  --success-soft: #d8e6d4;
  --danger: #b54942;
  --danger-soft: #efd4d1;
  --teal: #25756c;
  --teal-soft: #cbe4df;
  --shadow-panel: 0 1px 2px rgb(40 34 24 / 6%), 0 8px 28px rgb(40 34 24 / 7%);
  --shadow-overlay: 0 12px 36px rgb(24 20 15 / 18%);
```
Add each new name to the `@theme inline` block (near the top of the file) the same way existing tokens like `--color-sidebar` are mapped, e.g. `--color-surface: var(--surface);`, so `bg-surface`, `text-warning`, etc. become valid Tailwind utilities.

- [ ] **Step 3: Verify tokens resolve**

```bash
npm run build
```
Expected: build succeeds with no "unknown utility class" warnings once Steps 4+ start using `bg-surface`/`text-warning` etc.

- [ ] **Step 4: Build `EmptyState`**

Create `src/components/ui/empty-state.tsx`:
```tsx
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  message?: string;
  action?: { label: string; onClick?: () => void; href?: string };
  className?: string;
}

export function EmptyState({ icon: Icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 py-10 text-center", className)}>
      <Icon className="w-8 h-8 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {message && <p className="text-sm text-muted-foreground max-w-sm">{message}</p>}
      {action && (
        action.href ? (
          <a href={action.href} className="mt-2 text-sm font-medium text-primary hover:underline">
            {action.label}
          </a>
        ) : (
          <button type="button" onClick={action.onClick} className="mt-2 text-sm font-medium text-primary hover:underline">
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
```
This consolidates the seven ad-hoc empty states found in the codebase (dashboard, notifications, closed projects, board columns, related docs, saved filters, query results) — they're switched over in Task 7, not here, to keep this task's diff limited to foundation.

- [ ] **Step 5: Build `PageHeader`, `MetricCard`, `PropertyRow`, `MonoMeta`**

Create `src/components/ui/page-header.tsx`:
```tsx
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 flex-wrap", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground mb-1">{eyebrow}</p>
        )}
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
```

Create `src/components/ui/metric-card.tsx`:
```tsx
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: { direction: "up" | "down" | "flat"; label: string };
  className?: string;
}

export function MetricCard({ label, value, icon: Icon, trend, className }: MetricCardProps) {
  return (
    <div className={cn("rounded-[10px] bg-surface shadow-[var(--shadow-panel)] p-4", className)}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />}
      </div>
      <p className="font-mono text-2xl font-semibold text-foreground mt-1">{value}</p>
      {trend && <p className="text-xs text-muted-foreground mt-1">{trend.label}</p>}
    </div>
  );
}
```

Create `src/components/ui/property-row.tsx`:
```tsx
import { ReactNode } from "react";

export function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-border-soft last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
```

Create `src/components/ui/mono-meta.tsx`:
```tsx
import { cn } from "@/lib/utils";

export function MonoMeta({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs text-muted-foreground", className)}>{children}</span>;
}
```

- [ ] **Step 6: Extend `card.tsx` and `badge.tsx` instead of creating parallel components**

`src/components/ui/card.tsx` already provides the raised-surface/radius/shadow primitive the handoff calls `SurfacePanel` — read the file first (`Read src/components/ui/card.tsx`) and add, only if missing: a `CardHeader` sub-row that accepts a title + short supporting line + optional trailing action (matching the mockup's `.panel-head` — title, subtitle paragraph, right-aligned text-button), using the new `--surface`/`--shadow-panel` tokens instead of any existing flat border. Do not rename the exported `Card` component or its existing prop names — later tasks (issue detail, board, dashboard) reuse them as-is.

`src/components/ui/badge.tsx` already uses `cva` — read it, then add two new exported components in the same file reusing its existing `badgeVariants` pattern:
```tsx
const statusChipVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      category: {
        TODO: "bg-[var(--surface-active)] text-muted-foreground",
        IN_PROGRESS: "bg-[var(--warning-soft)] text-[var(--warning)]",
        DONE: "bg-[var(--success-soft)] text-[var(--success)]",
      },
    },
  }
);

export function StatusChip({ category, label }: { category: "TODO" | "IN_PROGRESS" | "DONE"; label: string }) {
  return <span className={statusChipVariants({ category })}>{label}</span>;
}

const priorityColor: Record<"CRITICAL" | "HIGH" | "MEDIUM" | "LOW", string> = {
  CRITICAL: "text-[var(--danger)]",
  HIGH: "text-[var(--warning)]",
  MEDIUM: "text-[var(--info)]",
  LOW: "text-muted-foreground",
};

export function MetaChip({ priority, label }: { priority: keyof typeof priorityColor; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${priorityColor[priority]}`}>
      {label}
    </span>
  );
}
```
`StatusCategory` is `TODO | IN_PROGRESS | DONE` per `prisma/schema.prisma:42-46` — do not invent a fourth category. Priority text must never be color-only per the handoff's accessibility rule — callers pass a `label` (e.g. an icon or the word itself), color is a supplement, not the only signal.

- [ ] **Step 7: Restyle `Sidebar.tsx` — compact workspace switcher + fix the mobile cutoff (JFR-143)**

Read the current file fully first (`Read src/components/layout/Sidebar.tsx`) since line numbers below are from the exploration pass and may have shifted.

Replace the logo block (current lines ~69–125, the `<img src="/logo-dark.png">`/`<img src="/logo-light.png">` pair) with a compact workspace-switcher button per the mockup's `.workspace-switcher` (lines 134–148 of `jedforge-ui-mockups.html`): a 34×34 mark, workspace name, and a chevron. Use `jedforge-wordmark.svg`'s gear-only portion (the `<g transform="translate(80,80)">...</g>` group, viewBox adjusted to `0 0 160 160`) inlined as JSX, **not** the raster `logo-light.png`/`logo-dark.png` — this is the actual fix for JFR-152's "white box" complaint at the root: those PNGs have an opaque white background baked in with no alpha channel, and the redesign's sidebar is dark in both themes (mockup's `:root` sets `--sidebar: #24231f` even in light mode — the sidebar itself never goes light). Since the SVG's own `<style>` block uses `@media (prefers-color-scheme: dark)`, which does **not** track the app's manual `next-themes` toggle, convert its `.jf-gear`/`.jf-word`/etc. rules to plain fills using `currentColor` or Tailwind `dark:` classes on the inlined `<g>`/`<text>` elements instead of keeping the media-query `<style>` block — the gear body should just always render in the sidebar's light foreground color (`#d9d5cc`-ish, matching the existing sidebar text color already used elsewhere in this file) since the sidebar background doesn't change with theme.

Fix the mobile cutoff (JFR-143): find the root sidebar container (`flex flex-col ... h-screen`) and its `<nav className="flex-1 px-3 py-4 space-y-1">`. Add `overflow-y-auto min-h-0` to the `<nav>` className, and add `flex-shrink-0` to the bottom user/account `<div className="p-3 border-t border-sidebar-border">` section so it can never be squeezed out. Add `pb-[env(safe-area-inset-bottom)]` to that same bottom section for notched-device safe areas.

Add small uppercase section labels ("WORKSPACE", "PROJECT", "ACCOUNT" or similar, matching the mockup's grouping) above the relevant nav groups using `MonoMeta`.

Restyle the active-nav-item indicator: raised dark surface (`bg-surface-raised`) plus a 2px rust inset marker (`shadow-[inset_2px_0_0_var(--primary)]` or a real left-border element) instead of whatever the current active-state class is — read the current active-item className first and replace only its color/surface classes, not its click handler or `href` logic.

- [ ] **Step 8: Restyle `Header.tsx` and `DashboardShell.tsx`**

`Header.tsx`: make the bar visually quieter (translucent `bg-surface/80 backdrop-blur`, `h-[58px]` instead of `h-14`, `border-b border-border-soft` instead of the current solid border) — do not change `getBreadcrumbs`, `getPageTitle`, `getProjectKey`, or the `dynamicTitle`/`PageTitleContext` logic; this is a pure class-name/height change. Keep `NotificationBell`, `ThemeToggle`, and the project-gated "Create Issue" button exactly as-is (same `projectKey` conditional).

`DashboardShell.tsx`: no structural change beyond passing through any new className additions — its `sidebarOpen`/`collapsed`/localStorage-persistence logic and the `/` keyboard-shortcut handler are unchanged. Remove the mobile-only top-bar's own logo `<img>` (lines ~100–118) if it duplicates the sidebar's new workspace-switcher mark, replacing it with the same inlined SVG mark at a smaller size — do not remove the hamburger button or its click handler.

- [ ] **Step 9: Acceptance check**

- No `<img src="/logo-*.png">` remains in `Sidebar.tsx` or `DashboardShell.tsx`.
- At mobile width (390px, from `resize_window`), open the sidebar drawer, scroll the nav, and confirm the account/sign-out section at the bottom is always reachable and never clipped.
- Toggle collapsed/expanded and dark/light — no layout shift beyond the intended width change; role-gated Admin nav item still only shows for admins (log in as `member@jedforge.dev` locally and confirm it's absent, then `admin@jedforge.dev` and confirm it's present).

- [ ] **Step 10: Run gates and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git add src/app/globals.css src/app/layout.tsx src/components/layout/Sidebar.tsx src/components/layout/Header.tsx src/components/layout/DashboardShell.tsx src/components/ui/card.tsx src/components/ui/badge.tsx src/components/ui/page-header.tsx src/components/ui/metric-card.tsx src/components/ui/property-row.tsx src/components/ui/mono-meta.tsx src/components/ui/empty-state.tsx
git commit -m "feat(design): establish redesign tokens, fonts, and app shell (JFR-145, JFR-143)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Dashboard redesign (JFR-146)

**Files:**
- Modify: `src/app/(dashboard)/page.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `MetricCard`, `EmptyState` from Task 2; existing `ActivityFeed` (now bug-fixed by Task 1).
- Produces: no new exports — this is a leaf page.

- [ ] **Step 1: Read the current file in full**

```bash
sed -n '1,280p' "src/app/(dashboard)/page.tsx"
```
Confirm the four existing Prisma-backed queries (`getUserProjects`, `getAssignedIssues` take 5, `getUpcomingDueDates` take 7-day-window take 5, `getRecentActivity` take 10) and note their exact return shapes before changing any JSX — the redesign must not change what's queried, only how it's laid out. Per the handoff's data rule, do **not** add a query for a historical completion trend/sparkline in this task; the six-week chart shown in the mockup has no justified query yet.

- [ ] **Step 2: Replace the greeting with `PageHeader`**

Replace whatever renders "Welcome back, {name}" today with:
```tsx
<PageHeader
  eyebrow={format(new Date(), "EEEE, MMMM d")}
  title={`Welcome back, ${session.user.name?.split(" ")[0] ?? "there"}`}
  subtitle="Here's what needs your attention today."
/>
```
(Use whatever date-formatting import already exists in this file — likely `date-fns`'s `format`, already a dependency per `ActivityFeed.tsx`'s `formatDistanceToNow` usage — don't add a new date library.)

- [ ] **Step 3: Replace the 3 stat cards with 4 `MetricCard`s driven by real counts**

Keep the existing "active projects" and "total issues" counts. Add "assigned to you" (already queried) and "due soon / overdue" (from the existing `getUpcomingDueDates` result — count items, don't refetch) as the four `MetricCard`s. Query true counts (`prisma.issue.count(...)`) separately from the 5-item lists already fetched — do not slice `.length` off a `take: 5` array as a stand-in for a real count, since that would silently cap the displayed number at 5.

- [ ] **Step 4: Restructure into "Needs your attention" / "Recent activity" / "Recent docs" panels**

Use the extended `Card`/`SurfacePanel` header pattern from Task 2 (title + short supporting line + optional "View board" text-action) for each of the three panels, matching `jedforge-ui-mockups.html` lines 752–769 structurally (not literally copying their sample data). "Needs your attention" surfaces the existing assigned/due-soon data, prioritized (overdue first, then due-soonest, then unassigned-critical if that query already exists — if it doesn't, use only assigned+due-soon data already fetched; do not add a new "critical unassigned" query in this task unless it's trivial to add to the existing `getAssignedIssues`-style query).

- [ ] **Step 5: Add designed empty states**

Use `EmptyState` (Task 2) for: no projects, no assigned work, no due dates, no activity (delegate to `ActivityFeed`'s own empty state, already present), no recent docs. Each needs a real one-sentence message and, where permission allows, an action (e.g. "Create a project" link) — reuse whatever create-permission check already gates project creation elsewhere in the app; do not invent a new one.

- [ ] **Step 6: Verify data-rule compliance**

```bash
grep -n "59%\|17 of 29\|sparkline\|chart-line" "src/app/(dashboard)/page.tsx"
```
Expected: no matches — confirms no mockup sample chart data was copied in.

- [ ] **Step 7: Manual check at all four breakpoints**

`preview_start` the dev server, then check 1440/1024/768/390px in both themes: normal data, and each of the five empty-section states (temporarily point a test account at a project with no assigned issues / no due dates to see the empty states for real, rather than guessing they render correctly).

- [ ] **Step 8: Run gates and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git add "src/app/(dashboard)/page.tsx"
git commit -m "feat(dashboard): redesign with real counts and designed empty states (JFR-146)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Kanban board redesign (JFR-147)

**Files:**
- Modify: `src/components/board/KanbanBoard.tsx`, `KanbanColumn.tsx`, `KanbanCard.tsx`

**Interfaces:**
- Consumes: `MetaChip`, `StatusChip`, `EmptyState` from Task 2.
- Produces: no new exports.

**Explicit scope decision (see "Decisions" above):** WIP limits are **display-only issue counts**, not enforced limits — there is no schema field for a per-column limit today, and adding one is a separate migration/settings-UI product decision. Do not fabricate a limit value or an "over WIP" red state.

- [ ] **Step 1: Read all three files in full before editing**

```bash
sed -n '1,221p' src/components/board/KanbanBoard.tsx
sed -n '1,111p' src/components/board/KanbanColumn.tsx
sed -n '1,104p' src/components/board/KanbanCard.tsx
```
Locate the `DndContext`/`PointerSensor`/`handleDragOver`/`handleDragEnd` logic in `KanbanBoard.tsx` and the `moveIssue`/`reorderIssues` server-action calls — none of this changes in this task.

- [ ] **Step 2: Column header — category accent + count (no limit)**

In `KanbanColumn.tsx`, add a subtle top-edge accent using the status's `category` (`TODO`/`IN_PROGRESS`/`DONE` from `prisma/schema.prisma:42-46`) mapped through the same color scheme as `StatusChip` — e.g. a 2px top border in `--muted-decoration`/`--warning`/`--success` by category — and a softly tinted column background (`bg-[var(--surface)]` with a category-tinted `--*-soft` at low opacity). Replace the current plain issue-count text with the count still shown as plain text/badge (not a fabricated "X / Y" limit).

- [ ] **Step 3: Card layout**

In `KanbanCard.tsx`: lead with issue type icon + key (`MonoMeta`), then title, then a compact footer row with `MetaChip` for priority, a due-date badge (text + icon, red only via `--danger` when overdue — never color alone per the accessibility rule), and assignee avatar. Do not add a two-line description unless the existing Prisma select already includes `description` for board cards — check `board/page.tsx`'s issue `select` clause first; if `description` isn't selected, leave the extra line out rather than adding a new field to the query in this visual-only task (flag it instead as a one-line follow-up if you think it's worth a separate small query change).

- [ ] **Step 4: Empty column state**

Replace `KanbanColumn.tsx`'s current "No issues" + "Add one" button (existing lines ~85–98) with `EmptyState` (Task 2), keeping the same "add issue to this column" action wired to whatever handler the current button calls — do not change what clicking it does, only its visual presentation.

- [ ] **Step 5: Closed/Done collapse toggle (client-side view state only)**

Add a column-level "collapse Done" toggle chip that hides a Done/Canceled-category column's cards behind a click, storing the toggle in local component state (or `localStorage` if you want it to persist per the sidebar-collapse precedent from JFR-101) — this must be purely a client-side view preference, never changing which issues are fetched from the server or their actual `statusId`.

- [ ] **Step 6: Slim scrollbar**

Add a `scrollbar-none`-adjacent thin-scrollbar utility class to the board's horizontal-scroll container (check if `scrollbar-none` already used in `globals.css` line ~ per the exploration pass — if so, add a sibling utility for a *visible but slim* scrollbar rather than reusing `scrollbar-none`, since the board needs a visible scrollbar, unlike whatever currently uses `scrollbar-none`).

- [ ] **Step 7: Interaction checks — do not skip**

Manually verify in the browser: clicking a card still opens the issue; dragging within a column and across columns still works and persists after a page refresh; a sprint-mode board with no active sprint still renders its existing "no active sprint" state; a Kanban-mode board is unaffected by any sprint-only code path.

- [ ] **Step 8: Force a rollback and verify it still works (Review Focus #5)**

Temporarily add `throw new Error("test")` at the top of the `moveIssue` server action, drag a card, confirm the card visually snaps back to its original column/position and a toast/error indicator appears, then remove the temporary throw. This is the one interaction that looks identical whether or not rollback is broken, so it must be checked by actually breaking it.

- [ ] **Step 9: Run gates and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git add src/components/board/KanbanBoard.tsx src/components/board/KanbanColumn.tsx src/components/board/KanbanCard.tsx
git commit -m "feat(board): redesign columns and cards, display-only WIP counts (JFR-147)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Issue detail redesign (JFR-148)

**Files:**
- Modify: `src/components/issues/IssueDetail.tsx` (668 lines — read in full before editing; this is explicitly the highest regression-risk file per the handoff)

**Interfaces:**
- Consumes: `PageHeader`, `PropertyRow`, `StatusChip`, `MetaChip`, `MonoMeta` from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Read the full file and map every mutation call site first**

```bash
grep -n "await update\|onSubmit\|onChange=.*handle\|server action\|use server" src/components/issues/IssueDetail.tsx
```
Write down (for your own reference while editing, not for the diff) every place a native `<select>`/`<input>` calls a mutation — status/priority/type `InlineSelect` (current lines ~177–213, ~567–586 per the exploration pass), assignee select, due-date input, custom fields. None of these onChange handlers or the mutations they call may change in this task.

- [ ] **Step 2: Hero header**

Replace the current top section with a `PageHeader`-style hero: project breadcrumb (keep the existing `ParentPicker`, lines ~339–354, unchanged), type icon + issue key (`MonoMeta`) + large editable title (keep `EditableTitle`, lines ~124–173, unchanged — wrap it, don't rewrite it), and compact `StatusChip`/`MetaChip` next to the title reflecting current status/priority read-only at a glance (the actual editable controls stay in the properties rail per Step 3 — this is a restated-for-scanning display, not a second set of controls).

- [ ] **Step 3: Properties rail as `PropertyRow`s**

Replace the current stack of full-width native `<select>` boxes in the sidebar column (~lines 534–656) with `PropertyRow` wrappers, keeping every existing `<select>`/`<input type="date">` element exactly as-is *inside* each row (per the handoff: "editing can still open or reveal the existing native controls; do not alter mutation behavior") — only the surrounding layout/visual container changes from "full-width bordered box" to "quiet label/value row." Order: Status, Priority, Assignee, Type, Due Date, Labels, then Custom Fields (`CustomFieldsPanel`, unchanged internals).

- [ ] **Step 4: Demote Delete**

Move the Delete Issue button (current lines ~644–655) to the visual bottom of the rail with low-emphasis styling (text-only or ghost button, not a full-width red button) — keep the exact same `ConfirmDialog` usage and the same delete handler/mutation call, this is a className + position change only.

- [ ] **Step 5: Reporter/Created/Updated metadata**

Move the read-only reporter/created/updated card (~lines 629–642) into a visually subdued group (smaller text, `--muted-decoration` for the labels, `--muted-foreground` for the actual values per the handoff's rule that muted-decoration is "too subdued for small required text") — below the custom fields panel, above the demoted delete button.

- [ ] **Step 6: Activity timeline styling**

Wrap the existing `ActivityFeed` (line ~527–531, already bug-fixed by Task 1) and `CommentThread`/`CommentForm` (~502–525) in a shared timeline container that visually distinguishes comments from field-change entries (e.g. a comment gets a filled avatar circle + surface background, a field-change gets a plain timeline dot) — do not change either component's props or the comment-submission mutation.

- [ ] **Step 7: AI chat responsive behavior (Review Focus #4)**

Read the current `AiChatPanel` wrapper (~lines 660–664, `xl:w-[420px] xl:sticky xl:top-6`). Confirm/adjust so that: at `xl:` and above, chat is a right rail and the two-column content (main + properties rail) keeps a readable width; below `xl:`, chat stacks full-width below the issue content (not squeezed beside it) — test specifically at 1024px and 1279px widths with `aiChatEnabled` true, since that's the band most likely to show a squeeze.

- [ ] **Step 8: Manual verification across states**

At 1440/1024/768/390px, in both themes, check: editable vs read-only (closed project or insufficient role — confirm `PropertyRow`'s controls are actually disabled/hidden the same way the current native selects already are, not just visually greyed while still submitting), a long title, long description content, an issue with many custom fields, and AI chat enabled vs. disabled.

- [ ] **Step 9: Run gates and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
npm run test:integration
git add src/components/issues/IssueDetail.tsx
git commit -m "feat(issue-detail): hero header, properties rail, demoted delete (JFR-148)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

`test:integration` is included here specifically because this file touches permission-gated mutation call sites (Review Focus #2/#3) and the repo's `CLAUDE.md` requires the DB-backed cross-tenant suite before touching anything permission-adjacent.

---

### Task 6: Docs home + document reader redesign, including the duplicate-heading fix (JFR-149)

**Files:**
- Modify: `src/app/(dashboard)/projects/[projectKey]/docs/page.tsx`
- Modify: `src/app/(dashboard)/projects/[projectKey]/docs/[pageId]/page.tsx`
- Modify: `src/components/docs/doc-page-editor.tsx`, `doc-document-view.tsx`, `docs-list-body.tsx`, `recently-viewed-docs.tsx`, `doc-toc-rail.tsx`
- Create: `src/components/docs/doc-workbar.tsx`

**Duplicate-heading root cause (confirmed by reading the live files, not the mockup):** it is **not** that either `doc-page-editor.tsx` or `doc-document-view.tsx` renders its own title twice internally — each renders exactly one `<h1>`. The duplication is that the global `Header.tsx` breadcrumb (via `SetPageTitle`, set in both branches of `[pageId]/page.tsx`) shows the full doc title as its last breadcrumb segment, directly above each component's *own*, separate "top bar" (a back-link + History/Delete/Share/Edit buttons with no title in it), directly above the `<h1>` again — three stacked rows where the title effectively appears twice in quick succession with an actionless bar sandwiched between. The fix is to merge the component's existing top bar and the title into one unified workbar (matching the mockup's single `.doc-workbar` row: back button + truncated title + actions, `jedforge-ui-mockups.html` lines 941–945) and stop setting a redundant `SetPageTitle` for this route — or keep `SetPageTitle` only for the browser tab title/global breadcrumb trail up to "Docs," not repeating the full doc title there.

- [ ] **Step 1: Build the shared `DocWorkbar`**

Create `src/components/docs/doc-workbar.tsx`:
```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReactNode } from "react";

interface DocWorkbarProps {
  backHref: string;
  backLabel: string;
  title: string;
  actions?: ReactNode;
}

export function DocWorkbar({ backHref, backLabel, title, actions }: DocWorkbarProps) {
  return (
    <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border-soft">
      <Link href={backHref} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
        <ArrowLeft className="w-4 h-4" />
        <span>{backLabel}</span>
      </Link>
      <span className="w-px h-4 bg-border flex-shrink-0" />
      <span className="text-sm font-medium text-foreground truncate min-w-0 flex-1">{title}</span>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Wire `DocWorkbar` into `doc-page-editor.tsx`**

Replace the existing "Top bar" block (the `Link` + History/Delete/Share/Edit-mode buttons, current lines ~152–235) with `<DocWorkbar backHref={...} backLabel="Docs" title={mode === "edit" ? "Editing" : savedTitle} actions={<>...the same History/Delete/Share/Edit buttons, unchanged handlers.../></>} />`. Keep the article's own `<h1>{savedTitle}</h1>` (line ~284) exactly as-is — it remains the one large, real heading; the workbar's title text should be visually smaller/quieter (it already is, in the component above) so the two don't compete.

- [ ] **Step 3: Same treatment in `doc-document-view.tsx`**

Apply the identical `DocWorkbar` swap to its "Top bar" (current lines ~112–160) and keep its `<h1>` (lines ~167–170) as the sole large heading.

- [ ] **Step 4: Stop duplicating the title in the global breadcrumb**

In `[pageId]/page.tsx`, change both `<SetPageTitle title={page.title} />` calls to `<SetPageTitle title="Docs" />` (or omit the component entirely if `Header.tsx`'s default segment-label fallback for the `docs` path segment already reads reasonably) — the goal is that `Header.tsx`'s breadcrumb no longer repeats the full doc title right above the new workbar, which itself now carries the title. Verify against `Header.tsx`'s `getBreadcrumbs`/`dynamicTitle` logic (unchanged) that this doesn't break breadcrumb navigation for any other route — `SetPageTitle` is scoped per-page via `PageTitleContext`, so this change is local to the doc-reader route only.

- [ ] **Step 5: Docs home layout**

In `docs/page.tsx`: apply `PageHeader` for the page title/actions row. Rename `RecentlyViewedDocs`' section heading to "Recently viewed" if it currently says anything implying persistence/pinning (check current copy first) — per the handoff, do not call this "Pinned" since pinning isn't a real persisted feature. Present `DocsListBody`'s page list in a denser, table-like panel (title, status, author, updated date columns) without changing its existing collapsible-section/drag-and-drop logic. Do not add a second navigation rail alongside the existing `DocsSidebarLayout`.

- [ ] **Step 6: Add the doc-space-wide empty state**

`docs-list-body.tsx` currently only has a per-section "No pages in this section" empty state (line ~73) with no top-level empty state for a docspace with zero pages and zero sections (a real gap found during exploration). Add an `EmptyState` (Task 2) for that top-level case, with a create-page action gated behind the same permission check `CreateDocItemButtons` already uses — do not duplicate or loosen that permission check.

- [ ] **Step 7: Constrain article width and style the TOC rail**

In whichever component wraps `RichTextDisplay`'s article container, constrain to ~700–760px max-width for reading content (the properties rail/related-docs panel outside that constraint can use the fuller page width). In `doc-toc-rail.tsx`, make it `sticky` on wide screens with a rust (`--primary`) active-item marker — its heading-extraction `useEffect` must keep an empty dependency array per `.context-docs/docs-invariants.md` rule 13; do not add a dependency to "fix" a lint warning here, that's a documented, deliberate exception.

- [ ] **Step 8: Preserve the file-document reader's distinct treatment**

`doc-document-view.tsx` (PDF/DOCX preview) keeps its dedicated viewer — apply the new shell/surface language (Step 3's workbar, panel backgrounds) but do not force the PDF iframe or DOCX `rich-prose` preview into the native article's 700–760px width constraint from Step 7.

- [ ] **Step 9: Manual verification**

Check: doc-space list populated and empty, a closed-project docspace (read-only banner still shows, edit/delete controls still hidden per `isDocsWriteLocked()`), native doc view/edit/history-panel-open/long-TOC states, and PDF/DOCX/unsupported-preview/loading/error states for the file viewer — confirm the title now appears exactly once as a large heading per page, with the workbar's copy clearly secondary (smaller, muted).

- [ ] **Step 10: Run gates and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git add "src/app/(dashboard)/projects/[projectKey]/docs" src/components/docs/doc-workbar.tsx src/components/docs/doc-page-editor.tsx src/components/docs/doc-document-view.tsx src/components/docs/docs-list-body.tsx src/components/docs/recently-viewed-docs.tsx src/components/docs/doc-toc-rail.tsx
git commit -m "feat(docs): unify workbar/title and redesign docs home + reader (JFR-149)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Consolidate empty states app-wide (JFR-150)

**Files:**
- Modify: `src/app/(dashboard)/notifications/page.tsx:17-21`
- Modify: `src/app/(dashboard)/projects/closed/page.tsx:52`
- Modify: `src/components/issues/RelatedDocsSection.tsx:104, 211`
- Modify: `src/components/query/SavedFilters.tsx:104`
- Modify: `src/components/query/QueryResults.tsx:66-73, 98`
- Modify: `src/components/board/KanbanColumn.tsx` (verify Task 4 already switched this one)
- Modify: `src/components/docs/docs-list-body.tsx` (verify Task 6 already switched this one)

**Interfaces:**
- Consumes: `EmptyState` from Task 2.

This task is mechanical now that `EmptyState` exists and Tasks 4/6 already converted the board-column and docs-space cases — it's a sweep over the remaining five ad-hoc locations found during the codebase survey.

- [ ] **Step 1: Notifications**

In `notifications/page.tsx`, replace the current "No notifications yet" block (with `BellOff` icon) with `<EmptyState icon={BellOff} title="No notifications yet" message="You'll see mentions, assignments, and updates here." />`.

- [ ] **Step 2: Closed projects**

In `projects/closed/page.tsx:52`, replace the plain-text "No closed projects." (currently no icon) with `<EmptyState icon={Archive} title="No closed projects" message="Projects you close will appear here." />` (import `Archive` from `lucide-react`).

- [ ] **Step 3: Related docs panel**

In `RelatedDocsSection.tsx`, replace both empty-text locations (line ~104 "No pages in this project yet."/"No matching pages.", line ~211 "No related docs.") with `EmptyState`, using distinct messages for the "no pages exist" vs. "search matched nothing" cases at line 104 (don't collapse them into one identical message — a user searching who gets zero matches needs different guidance than a project with genuinely no docs yet).

- [ ] **Step 4: Saved filters**

In `SavedFilters.tsx:104`, replace "No saved filters yet" with `EmptyState`, action linking to wherever the "create filter" flow starts today (check the existing surrounding JSX for that entry point rather than inventing a new one — `SavedFilter` requires `projectId` per `.context-docs/data-integrity.md`, so this only ever renders on a project-scoped page, not the global `/search` page).

- [ ] **Step 5: Query results**

In `QueryResults.tsx`, the local `EmptyState()` function (lines 66–73) is the closest thing to a shared component already — replace its body with a call to the new shared `EmptyState` import and delete the local function definition, keeping its call site at line 98 unchanged in what it passes.

- [ ] **Step 6: Verify no stray empty-state markup remains**

```bash
grep -rn "No issues match your query\|No notifications yet\|No closed projects\|No saved filters yet\|No pages in this project\|No related docs" src/ --include="*.tsx" | grep -v empty-state.tsx
```
Expected: no output — everything now routes through the shared component (the grep intentionally excludes `empty-state.tsx`'s own file since a default `message` prop could legitimately contain similar wording).

- [ ] **Step 7: Run gates and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git add src/app/\(dashboard\)/notifications/page.tsx src/app/\(dashboard\)/projects/closed/page.tsx src/components/issues/RelatedDocsSection.tsx src/components/query/SavedFilters.tsx src/components/query/QueryResults.tsx
git commit -m "feat(empty-states): consolidate ad-hoc empty states onto shared EmptyState (JFR-150)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Port to light mode (JFR-152)

**Files:**
- Modify: `src/app/globals.css` (`:root` block only)

**Interfaces:**
- Consumes: the approved light palette from the handoff (`Claude Code Handoff.md` lines 122–137) and `jedforge-ui-mockups.html`'s `:root` block (lines 16–41).

By this point the sidebar-logo "white box" issue is already resolved as a side effect of Task 2 (the inlined SVG mark replaced the opaque PNGs), so this task is purely the token pass — no shell/component changes needed.

- [ ] **Step 1: Replace the placeholder light-mode token values from Task 2 Step 2**

In `:root`, replace the Task-2 placeholder mappings (`--sidebar-raised: var(--sidebar);` etc.) with the real approved light values:
```css
  --sidebar-raised: #2c2b26;
  --surface: #fffefa;
  --surface-raised: #eeece6;
  --surface-active: #e7e4dc;
  --border-soft: #e8e4dc;
  --primary-soft: #f1d7cc;
```
Also update the core `--background`, `--foreground`, `--border`, `--primary`, `--primary-hover`-equivalent tokens to the approved warm-light values (`#f5f3ee` / `#25241f` / `#dcd8cf` / `#b84f2c` / `#d1643f`) if they don't already match — diff against the current `:root` values first (`grep -n "^  --" src/app/globals.css` before and after) since some of these may already be close from the earlier JFR-103 color-overhaul work.

- [ ] **Step 2: Confirm the sidebar stays dark in light mode**

Per the mockup, `--sidebar` remains a dark charcoal (`#24231f`) even inside `:root` — verify `Sidebar.tsx`'s classes reference `bg-sidebar`/`text-sidebar-foreground` tokens (not `bg-background`) so it doesn't flip to a light background when the app theme is light. This was already true before this plan (per the exploration pass, `--sidebar` was already dark-navy-ish in `:root`) — this step is a verification, not necessarily a code change.

- [ ] **Step 3: Contrast check**

For every new/changed light-mode token pairing (text-on-surface, muted-foreground-on-background, chip text-on-chip-background), confirm WCAG AA (4.5:1 normal text / 3:1 large text or UI-only) — reuse whatever contrast-check approach the `2026-08-04-jfr-103-color-overhaul` plan used (inline ratio calculation) rather than introducing a new tool.

- [ ] **Step 4: Manual verification across all six screens**

Switch to light mode and re-check dashboard, board, issue detail, docs home, and doc reader at 1440/1024/768/390px — same states as the earlier per-screen tasks' manual checks, just the other theme. Confirm no screen looks like "dark mode with the background swapped" — text weight/hierarchy should read the same as the approved light mockup.

- [ ] **Step 5: Run gates and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git add src/app/globals.css
git commit -m "feat(design): port redesign tokens to light mode (JFR-152)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Close out JFR-144**

Once Tasks 1–8 are all merged to `main` and the after-merge CI/deploy check has passed per `CLAUDE.md`, mark JFR-144 (the tracking epic) Done and post a summary comment referencing the eight shipped issues.

---

## Verification Checklist (repeat at the end of every task above, not just once at the end)

From the handoff's own checklist — automated gates (`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`) plus, for permission-adjacent tasks (5, 6), `npm run test:integration`. Visual/functional/accessibility checks per screen are folded into each task's own "manual verification" step above rather than deferred to a single end-of-project pass, so a regression is caught by the task that introduced it.
