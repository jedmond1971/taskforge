import { FileSearch } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function IssueNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
      <EmptyState
        icon={FileSearch}
        title="Issue not found"
        message="This issue may have been deleted or you don't have access."
        action={{ label: "← Back to issues", href: "../../issues" }}
      />
    </div>
  );
}
