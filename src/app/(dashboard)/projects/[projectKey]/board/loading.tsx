import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div className="p-6">
      <Skeleton className="h-8 w-32 mb-6" />
      <div className="flex gap-4">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="flex-shrink-0 w-72 space-y-2">
            <div className="bg-surface border border-border-soft rounded-t-lg px-3 py-2.5">
              <Skeleton className="h-5 w-24" />
            </div>
            <div className="bg-surface border border-t-0 border-border-soft rounded-b-lg p-2 space-y-2 min-h-[120px]">
              {Array.from({ length: col === 0 ? 3 : col === 1 ? 2 : 1 }).map((_, i) => (
                <div key={i} className="bg-surface-active rounded-lg p-3 space-y-2">
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
    </div>
  );
}
