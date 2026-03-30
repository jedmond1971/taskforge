import { IssueStatus } from "@prisma/client";
import { STATUS_CONFIG } from "@/lib/issue-utils";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: IssueStatus; className?: string }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium transition-colors duration-200", cfg.bg, cfg.color, className)}>
      {cfg.label}
    </span>
  );
}
