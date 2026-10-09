import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the dashboard home (page.tsx) block for block: header, 4 metric cards,
// attention list, projects + activity columns, recent docs.
function PanelSkeleton({ rows, rowClass = "h-12" }: { rows: number; rowClass?: string }) {
  return (
    <div className="rounded-[10px] bg-surface shadow-[var(--shadow-panel)] p-4 space-y-3">
      <Skeleton className="h-5 w-40" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className={`${rowClass} w-full`} />
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="space-y-6 sm:space-y-8 max-w-6xl" aria-busy="true" aria-label="Loading dashboard">
      <div>
        <Skeleton className="h-4 w-36 mb-1" />
        <Skeleton className="h-8 sm:h-9 w-72 max-w-full" />
        <Skeleton className="h-5 w-60 max-w-full mt-1" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-[10px] bg-surface shadow-[var(--shadow-panel)] p-4 space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-14" />
          </div>
        ))}
      </div>
      <PanelSkeleton rows={4} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PanelSkeleton rows={3} />
        <PanelSkeleton rows={3} />
      </div>
      <PanelSkeleton rows={3} />
    </div>
  );
}
