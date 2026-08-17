import type { TocHeading } from "@/components/ui/rich-text-display";

interface DocTocRailProps {
  headings: TocHeading[];
}

export function DocTocRail({ headings }: DocTocRailProps) {
  if (headings.length === 0) return null;

  return (
    <div className="hidden lg:block w-[220px] shrink-0 pr-6">
      <div className="sticky top-4">
        <p className="text-[11px] font-bold tracking-wide text-zinc-400 dark:text-zinc-600 uppercase mb-2.5">
          In this page
        </p>
        <nav className="space-y-1.5">
          {headings.map((h) => (
            <a
              key={h.id}
              href={`#${h.id}`}
              className="block text-[12.5px] leading-snug text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
            >
              {h.text}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
