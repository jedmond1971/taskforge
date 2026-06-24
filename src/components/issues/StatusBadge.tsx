import { StatusCategory } from "@prisma/client";
import { CATEGORY_COLOR } from "@/lib/issue-utils";
import { cn } from "@/lib/utils";

export function StatusBadge({
  status,
  className,
}: {
  status: { name: string; category: StatusCategory };
  className?: string;
}) {
  const cfg = CATEGORY_COLOR[status.category];
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium transition-colors duration-200",
        cfg.bg,
        cfg.color,
        className
      )}
    >
      {status.name}
    </span>
  );
}
