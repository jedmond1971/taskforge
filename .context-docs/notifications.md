# In-App Notifications

Notifications are stored in the `Notification` table and created via `src/lib/notifications.ts`. **Always use the service — do not insert directly.**

## Trigger points (all fire-and-forget, never throw)
- `createIssue` / `updateIssue` in `src/app/(dashboard)/projects/[projectKey]/actions.ts` — assignment and status changes
- `PATCH /api/issues/[issueId]` in `src/app/api/issues/[issueId]/route.ts` — same two events via REST
- `addComment` in the same actions file — notifies assignee and reporter
- `moveIssue` (board drag-and-drop, JFR-184) — status change only, i.e. a cross-column move; a within-column reorder is silent. Recipients are assignee + reporter (there is no watcher concept), minus the person who dragged. The board's Undo goes through `moveIssue` too, so it notifies as well.

## Known gaps (wire up when touching these areas)
- @mention notifications: `notificationService.mention()` exists but is never called — wire it in `addComment` once a TipTap mention extension is added

## UI entry points
- `src/components/notifications/NotificationBell.tsx` — bell icon in header, fetches unread count on mount
- `src/components/notifications/NotificationDropdown.tsx` — 10 most recent, fetched on dropdown open
- `src/app/(dashboard)/notifications/page.tsx` — full list at `/notifications`

## Server actions
`src/app/(dashboard)/notifications/actions.ts`: `getNotifications`, `getUnreadCount`, `markNotificationRead`, `markAllNotificationsRead`

## Retention cap
Each user is capped at **100 notifications**. After every `createNotification` / `createNotifications` call, `pruneNotifications(userId)` deletes the oldest rows beyond the cap. The cap is defined as `NOTIFICATION_CAP = 100` in `src/lib/notifications.ts`.

## Real-time
No real-time push — notifications appear on next page load or dropdown open. SSE delivery is a separate planned feature.

**Board freshness (JFR-184), until SSE:** `AutoRefresh` (board, issues, backlog pages) refreshes every 3 min and when the tab becomes visible/focused again (at most once per 30 s). It holds off while `isBoardBusy()` (`src/lib/board-activity.ts`) — set by `KanbanBoard` during a drag and while a move is saving — and catches up once when the board goes idle. `KanbanBoard` shows a "Board updated" sonner toast (id `board-updated`) only when a refresh brings different data (`boardSignature`) and the user has not written in the last 8 s, so their own move's echo stays quiet. In the Browser pane, `document.visibilityState` is `hidden` when the app isn't focused, so the focus refresh needs `Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" })` plus a `visibilitychange` event to exercise.
