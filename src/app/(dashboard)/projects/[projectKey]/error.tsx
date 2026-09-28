"use client";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-8 text-center">
      <EmptyState
        icon={AlertTriangle}
        title="Something went wrong"
        message={error.message || "An unexpected error occurred. Please try again."}
        iconClassName="text-danger"
      />
      <div className="flex gap-3">
        <Button onClick={reset}>
          Try again
        </Button>
        <Button variant="outline" onClick={() => window.history.back()}>
          Go back
        </Button>
      </div>
    </div>
  );
}
