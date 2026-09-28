import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

const statusChipVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      category: {
        TODO: "bg-surface-active text-muted-foreground",
        IN_PROGRESS: "bg-warning-soft text-warning",
        DONE: "bg-success-soft text-success",
      },
    },
  }
)

function StatusChip({ category, label }: { category: "TODO" | "IN_PROGRESS" | "DONE"; label: string }) {
  return <span className={statusChipVariants({ category })}>{label}</span>
}

const priorityColor: Record<"CRITICAL" | "HIGH" | "MEDIUM" | "LOW", string> = {
  CRITICAL: "text-danger",
  HIGH: "text-warning",
  MEDIUM: "text-info",
  LOW: "text-muted-foreground",
}

function MetaChip({ priority, label }: { priority: keyof typeof priorityColor; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", priorityColor[priority])}>
      {label}
    </span>
  )
}

export { Badge, badgeVariants, StatusChip, MetaChip }
