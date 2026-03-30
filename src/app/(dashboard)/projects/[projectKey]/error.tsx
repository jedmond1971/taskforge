"use client";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
        <AlertTriangle className="w-7 h-7 text-red-400" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-zinc-100 mb-1">Something went wrong</h2>
        <p className="text-sm text-zinc-500 max-w-sm">
          {error.message || "An unexpected error occurred. Please try again."}
        </p>
      </div>
      <div className="flex gap-3">
        <Button onClick={reset} className="bg-indigo-600 hover:bg-indigo-500 text-white">
          Try again
        </Button>
        <Button variant="outline" onClick={() => window.history.back()} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
          Go back
        </Button>
      </div>
    </div>
  );
}
