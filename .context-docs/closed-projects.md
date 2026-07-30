# Closed project invariants

Projects have an `isClosed Boolean @default(false)` field. Rules enforced in code:

1. **Only `UserRole.ADMIN` can close or reopen a project** — `closeProject`/`reopenProject` actions in `src/app/(dashboard)/admin/actions.ts` call `requireAdmin()` before mutating.
2. **Active projects listing filters closed projects** — `src/app/(dashboard)/projects/page.tsx` adds `isClosed: false` to its Prisma query. Closed projects do not appear on the main Projects page for any user.
3. **Non-admins are redirected from most closed project URLs** — `src/app/(dashboard)/projects/[projectKey]/layout.tsx` redirects to `/projects` if the project is closed and the user is not an admin, **unless** the path matches `/projects/[key]/docs` (including sub-pages). Docs are intentionally accessible on closed projects. The layout reads the current path via `headers().get('x-pathname')`, which the middleware sets on every request. Admins can navigate anywhere in a closed project.
4. **`/projects/closed` is visible to all authenticated users** — non-admins see only closed projects they are members of; admins see all closed projects.
5. **Re-Open button is disabled for non-admins** — the button renders with `disabled` attribute and reduced opacity. The server action (`src/app/(dashboard)/projects/closed-actions.ts`) also re-checks admin role server-side.
6. **`getAdminProjects` uses explicit `select`** — if you add fields to the `Project` model that the admin panel needs to display, add them to the `select` block in that function (`src/app/(dashboard)/admin/actions.ts`).
7. **Dashboard filters closed projects; global Docs page does not** — all four queries in `src/app/(dashboard)/page.tsx` (`getUserProjects`, `getAssignedIssues`, `getUpcomingDueDates`, `getRecentActivity`) add `isClosed: false`. The global Docs page (`src/app/(dashboard)/docs/page.tsx`) shows all member projects — open ones at the top, closed ones in a separate "Closed Projects" section with a lock badge and read-only subtitle.
8. **There is no Archive concept** — the `isArchived` field and `archiveProject` action have been removed. Close (`isClosed`, admin-only) is the only project deactivation mechanism. Project settings Danger Zone contains only "Project Visibility" (admin-only toggle) and "Delete Project".
