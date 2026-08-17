import Link from "next/link";
import { History } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { DocPageStatus } from "@prisma/client";
import { DocTypeIcon } from "@/components/docs/doc-type-icon";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/user-display";

interface RecentlyViewedPage {
  page: {
    id: string;
    title: string;
    type: string;
    status: DocPageStatus;
    mimeType: string | null;
    author: { id: string; name: string; avatarUrl: string | null };
  };
  viewedAt: Date;
}

interface RecentlyViewedDocsProps {
  recentlyViewed: RecentlyViewedPage[];
  projectKey: string;
}

export function RecentlyViewedDocs({ recentlyViewed, projectKey }: RecentlyViewedDocsProps) {
  if (recentlyViewed.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
        <History className="w-3.5 h-3.5" />
        Recently viewed
      </div>
      <div className="flex gap-3 flex-wrap">
        {recentlyViewed.map(({ page, viewedAt }) => (
          <Link
            key={page.id}
            href={`/projects/${projectKey}/docs/${page.id}`}
            className="w-[230px] shrink-0 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3.5 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
          >
            <DocTypeIcon type={page.type} mimeType={page.mimeType} size={16} />
            <p className="mt-2.5 text-[13.5px] font-semibold leading-snug text-zinc-800 dark:text-zinc-200 line-clamp-2 min-h-[2.6em]">
              {page.title}
            </p>
            <div className="mt-2.5 flex items-center justify-between">
              <Avatar size="sm">
                <AvatarImage src={page.author.avatarUrl ?? undefined} />
                <AvatarFallback className="bg-primary text-primary-foreground text-[9px] font-semibold">
                  {getInitials(page.author.name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-[11px] text-zinc-400">
                {formatDistanceToNow(new Date(viewedAt), { addSuffix: true })}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
