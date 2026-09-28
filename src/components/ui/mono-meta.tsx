import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MonoMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs text-muted-foreground", className)}>{children}</span>;
}
