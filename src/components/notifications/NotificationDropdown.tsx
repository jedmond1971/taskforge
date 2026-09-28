"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BellOff } from "lucide-react";
import { getNotifications } from "@/app/(dashboard)/notifications/actions";
import { NotificationItem } from "./NotificationItem";
import { EmptyState } from "@/components/ui/empty-state";

type Notification = Awaited<ReturnType<typeof getNotifications>>[number];

interface NotificationDropdownProps {
  onUnreadCountChange?: (delta: number) => void;
}

export function NotificationDropdown({ onUnreadCountChange }: NotificationDropdownProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getNotifications(10)
      .then(setNotifications)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function handleRead(id: string) {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    onUnreadCountChange?.(-1);
  }

  return (
    <div className="w-80 rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">Notifications</span>
      </div>

      <div className="max-h-[360px] overflow-y-auto">
        {loading && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        )}

        {!loading && notifications.length === 0 && (
          <EmptyState icon={BellOff} title="You're all caught up" className="py-8" />
        )}

        {!loading && notifications.length > 0 && (
          <div className="py-1">
            {notifications.map((n) => (
              <NotificationItem key={n.id} notification={n} onRead={handleRead} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-2">
        <Link
          href="/notifications"
          className="text-xs text-primary hover:text-primary/80 transition-colors"
        >
          See all notifications →
        </Link>
      </div>
    </div>
  );
}
