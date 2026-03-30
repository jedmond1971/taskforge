import { IssuePriority } from "@prisma/client";
import { PRIORITY_CONFIG } from "@/lib/issue-utils";
import { cn } from "@/lib/utils";

export function PriorityBadge({ priority, className }: { priority: IssuePriority; className?: string }) {
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium transition-colors duration-200", cfg.bg, cfg.color, className)}>
      {cfg.label}
    </span>
  );
}
