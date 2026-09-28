"use client";

import { useEffect, useState } from "react";
import type { TocHeading } from "@/components/ui/rich-text-display";
import { cn } from "@/lib/utils";

interface DocTocRailProps {
  headings: TocHeading[];
}

export function DocTocRail({ headings }: DocTocRailProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (headings.length === 0) return;
    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px" }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <div className="hidden lg:block w-[220px] shrink-0 pr-6">
      <div className="sticky top-4">
        <p className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase mb-2.5">
          In this page
        </p>
        <nav className="space-y-1.5 border-l border-border-soft">
          {headings.map((h) => (
            <a
              key={h.id}
              href={`#${h.id}`}
              className={cn(
                "block pl-3 -ml-px border-l-2 text-[12.5px] leading-snug transition-colors",
                activeId === h.id
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {h.text}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
