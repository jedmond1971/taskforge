# In-App Notifications

Notifications are stored in the `Notification` table and created via `src/lib/notifications.ts`. **Always use the service — do not insert directly.**

## Trigger points (all fire-and-forget, never throw)
- `createIssue` / `updateIssue` in `src/app/(dashboard)/projects/[projectKey]/actions.ts` — assignment and status changes
- `PATCH /api/issues/[issueId]` in `src/app/api/issues/[issueId]/route.ts` — same two events via REST
- `addComment` in the same actions file — notifies assignee and reporter

## Known gaps (wire up when touching these areas)
- `moveIssue` (drag-and-drop board) does not fire status-change notifications
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
