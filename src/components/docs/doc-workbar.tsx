import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReactNode } from "react";

interface DocWorkbarProps {
  backHref: string;
  backLabel: string;
  title: string;
  actions?: ReactNode;
}

export function DocWorkbar({ backHref, backLabel, title, actions }: DocWorkbarProps) {
  return (
    <div className="flex items-center gap-3 mb-4 pb-3 border-b border-border-soft">
      <Link href={backHref} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
        <ArrowLeft className="w-4 h-4" />
        <span>{backLabel}</span>
      </Link>
      <span className="w-px h-4 bg-border flex-shrink-0" />
      <span className="text-sm font-medium text-foreground truncate min-w-0 flex-1">{title}</span>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
