import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  message?: string;
  action?: { label: string; onClick?: () => void; href?: string };
  className?: string;
}

export function EmptyState({ icon: Icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 py-10 text-center", className)}>
      <Icon className="w-8 h-8 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {message && <p className="text-sm text-muted-foreground max-w-sm">{message}</p>}
      {action && (
        action.href ? (
          <a href={action.href} className="mt-2 text-sm font-medium text-primary hover:underline">
            {action.label}
          </a>
        ) : (
          <button type="button" onClick={action.onClick} className="mt-2 text-sm font-medium text-primary hover:underline">
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
