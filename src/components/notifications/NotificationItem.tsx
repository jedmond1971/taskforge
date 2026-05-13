"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { markNotificationRead } from "@/app/(dashboard)/notifications/actions";

type NotificationItemData = {
  id: string;
  message: string;
  read: boolean;
  createdAt: Date;
  issue: {
    key: string;
    project: { key: string };
  } | null;
};

interface NotificationItemProps {
  notification: NotificationItemData;
  onRead?: (id: string) => void;
}

export function NotificationItem({ notification, onRead }: NotificationItemProps) {
  const issueHref =
    notification.issue
      ? `/projects/${notification.issue.project.key}/issues/${notification.issue.key}`
      : null;

  async function handleClick() {
    if (!notification.read) {
      await markNotificationRead(notification.id);
      onRead?.(notification.id);
    }
  }

  const inner = (
    <div
      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer ${
        !notification.read
          ? "border-l-2 border-[#FF6A00] pl-[10px]"
          : "border-l-2 border-transparent pl-[10px]"
      }`}
    >
      {!notification.read && (
        <span className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full bg-[#FF6A00]" />
      )}
      {notification.read && <span className="mt-1.5 flex-shrink-0 w-2 h-2" />}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-snug">
          {notification.message}
        </p>
        <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
        </p>
      </div>
    </div>
  );

  if (issueHref) {
    return (
      <Link href={issueHref} onClick={handleClick} className="block">
        {inner}
      </Link>
    );
  }

  return (
    <button onClick={handleClick} className="block w-full text-left">
      {inner}
    </button>
  );
}
