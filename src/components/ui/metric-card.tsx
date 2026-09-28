import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: { direction: "up" | "down" | "flat"; label: string };
  className?: string;
}

export function MetricCard({ label, value, icon: Icon, trend, className }: MetricCardProps) {
  return (
    <div className={cn("rounded-[10px] bg-surface shadow-[var(--shadow-panel)] p-4", className)}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />}
      </div>
      <p className="font-mono text-2xl font-semibold text-foreground mt-1">{value}</p>
      {trend && <p className="text-xs text-muted-foreground mt-1">{trend.label}</p>}
    </div>
  );
}
