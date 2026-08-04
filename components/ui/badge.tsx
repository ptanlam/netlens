import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The design carries two chip shapes, and which one you get is a matter of meaning,
 * not taste — so shape is bundled into the variant rather than exposed as a free axis:
 *
 * - `tag` — a **kind**: "Funds", "Credit", "Sinking fund". Square-ish 7px corner on the
 *   `--pane` step, muted ink. It labels a row; it never signals good or bad.
 * - everything else — a **state**: Active, Live, Behind. A full pill, tinted by tone.
 *
 * Keeping the two apart is what stops a neutral type label from reading as a verdict.
 */
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border border-transparent py-[3px] text-[11px] font-semibold whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        tag: "rounded-sm bg-pane px-[9px] text-muted-foreground",
        default:
          "rounded-4xl bg-primary px-[11px] text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "rounded-4xl bg-secondary px-[11px] text-secondary-foreground [a]:hover:bg-secondary/80",
        accent: "rounded-4xl bg-accent px-[11px] text-accent-brand",
        warning: "rounded-4xl bg-warning-bg px-[11px] text-warning",
        destructive:
          "rounded-4xl bg-destructive/10 px-[11px] text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "rounded-4xl border-border px-[11px] text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "rounded-4xl px-[11px] hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
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

export { Badge, badgeVariants }
