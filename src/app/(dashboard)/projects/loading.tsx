import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Skeleton className="h-8 sm:h-9 w-48" />
        <Skeleton className="h-5 w-24 mt-1" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border-soft rounded-xl p-5 space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
