import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the board: the project layout already supplies the padding, columns are
// w-64 sm:w-72 and fill the height (KanbanColumn).
export default function Loading() {
  return (
    <div className="h-full flex gap-3 sm:gap-4 overflow-x-hidden pb-4" aria-busy="true" aria-label="Loading board">
      {Array.from({ length: 4 }).map((_, col) => (
        <div key={col} className="flex flex-col flex-shrink-0 w-64 sm:w-72 h-full">
          <div className="bg-surface rounded-t-lg px-3 py-2.5 flex items-center gap-2">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="flex-1 bg-surface/60 rounded-b-lg p-2 space-y-2">
            {Array.from({ length: col === 0 ? 3 : col === 1 ? 2 : 1 }).map((_, i) => (
              <div key={i} className="bg-surface rounded-lg p-3 space-y-2 shadow-[var(--shadow-panel)]">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
