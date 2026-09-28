import { BellOff } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getNotifications } from "./actions";
import { NotificationItem } from "@/components/notifications/NotificationItem";
import { EmptyState } from "@/components/ui/empty-state";


export default async function NotificationsPage() {
  await requireUser();
  const notifications = await getNotifications();

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 mb-6">
        Notifications
      </h1>

      {notifications.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="No notifications yet"
          message="You'll see mentions, assignments, and updates here."
        />
      ) : (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
          {notifications.map((n) => (
            <NotificationItem key={n.id} notification={n} />
          ))}
        </div>
      )}
    </div>
  );
}
