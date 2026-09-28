import { FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <EmptyState
        icon={FileQuestion}
        title="404 — Page not found"
        message="The page you're looking for doesn't exist."
        action={{ label: "Go to dashboard", href: "/" }}
      />
    </div>
  );
}
