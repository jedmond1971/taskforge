import { Skeleton } from "@/components/ui/skeleton";

// Mirrors docs/page.tsx: max-w-3xl, heading + subtitle, then a stack of project cards.
export default function Loading() {
  return (
    <div className="max-w-3xl space-y-6" aria-busy="true" aria-label="Loading docs">
      <div>
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-5 w-72 max-w-full mt-1" />
      </div>
      <div className="grid gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4 bg-surface shadow-[var(--shadow-panel)] rounded-xl">
            <Skeleton className="w-10 h-10 rounded-lg shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-5 w-48 max-w-full" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
