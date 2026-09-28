import { cn } from "@/lib/utils";

const GEAR_TEETH = Array.from({ length: 12 }, (_, i) => i * 30);

export function ForgeMark({
  size = 34,
  className,
  holeColor = "var(--sidebar)",
}: {
  size?: number;
  className?: string;
  holeColor?: string;
}) {
  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      role="img"
      aria-label="JedForge"
      className={cn("flex-shrink-0", className)}
    >
      <g transform="translate(80,80)">
        {GEAR_TEETH.map((deg) => (
          <rect
            key={deg}
            x="-7"
            y="-58"
            width="14"
            height="14"
            rx="3"
            fill="currentColor"
            transform={`rotate(${deg})`}
          />
        ))}
        <circle r="47" fill="currentColor" />
        <circle r="20" fill={holeColor} />
        <polygon points="6,-18 -7,2 0,2 -6,18 9,0 2,0" fill="var(--primary)" />
      </g>
    </svg>
  );
}
