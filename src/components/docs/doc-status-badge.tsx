import { DocPageStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { DOC_STATUS_CONFIG } from "@/lib/doc-status";
import { cn } from "@/lib/utils";

interface DocStatusBadgeProps {
  status: DocPageStatus;
  className?: string;
}

export function DocStatusBadge({ status, className }: DocStatusBadgeProps) {
  const cfg = DOC_STATUS_CONFIG[status];
  return (
    <Badge variant="outline" className={cn("border-transparent", cfg.color, cfg.bg, className)}>
      {cfg.label}
    </Badge>
  );
}
