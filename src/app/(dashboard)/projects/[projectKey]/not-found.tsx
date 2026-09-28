import { Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function ProjectNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
      <EmptyState
        icon={Lock}
        title="Project not found"
        message="This project doesn't exist or you don't have access to it."
        action={{ label: "← Back to projects", href: "/projects" }}
      />
    </div>
  );
}
