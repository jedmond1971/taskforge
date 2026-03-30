import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div className="p-6 max-w-5xl">
      <Skeleton className="h-4 w-32 mb-4" />
      <div className="grid grid-cols-[1fr_280px] gap-6">
        <div className="space-y-6">
          <Skeleton className="h-8 w-3/4" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-5 w-24" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-7 w-7 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
