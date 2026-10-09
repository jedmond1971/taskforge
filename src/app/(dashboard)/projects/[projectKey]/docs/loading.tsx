import { Skeleton } from "@/components/ui/skeleton";

// Page-area skeleton for a project's docs and doc pages. The sidebar belongs to docs/layout.tsx,
// which is outside this boundary, so only the content column is drawn here.
export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading docs">
      <div>
        <Skeleton className="h-8 sm:h-9 w-32" />
        <Skeleton className="h-5 w-56 max-w-full mt-1" />
      </div>
      <div className="space-y-3 max-w-3xl">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-32 w-full mt-4" />
      </div>
    </div>
  );
}
