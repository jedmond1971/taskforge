import { Skeleton } from "@/components/ui/skeleton";

// Mirrors issues/page.tsx: heading + count with the Bulk Edit button, the filter bar, then the table.
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading issues">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Skeleton className="h-7 sm:h-8 w-24" />
          <Skeleton className="h-5 w-20 mt-1" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="flex gap-2 flex-wrap">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-32" />
        ))}
      </div>
      <div className="border border-border-soft rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 bg-surface-active/50 border-b border-border-soft">
          <Skeleton className="h-5 w-full" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border-soft last:border-b-0">
            <Skeleton className="h-4 w-4 shrink-0" />
            <Skeleton className="h-4 w-16 shrink-0" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-6 w-20 hidden sm:block" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-24 hidden md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
