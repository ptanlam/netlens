import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The design carries two chip shapes, and which one you get is a matter of meaning,
 * not taste — so shape is bundled into the variant rather than exposed as a free axis:
 *
 * - `tag` — a **kind**: "Funds", "Credit", "Sinking fund". An 8px corner on sage, in
 *   muted ink. It labels a row; it never signals good or bad.
 * - everything else — a **state**: Active, Live, Behind. A full pill, tinted by tone.
 *
 * Keeping the two apart is what stops a neutral type label from reading as a verdict.
 */
const badgeVariants = cva(
  // Wise's status pill: 14px semibold at 4×12 padding. Ours runs a step smaller (13px) since
  // it sits inside dense rows rather than on a marketing card.
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border border-transparent py-[3px] text-caption font-semibold whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3.5!",
  {
    variants: {
      variant: {
        // A kind, not a state: it has to sit quietly beside a name, so it runs smaller and
        // lighter than the status pills.
        tag: "rounded-sm bg-pane px-2 py-0.5 text-caption font-semibold text-muted-foreground",
        default:
          "rounded-4xl bg-primary px-3 text-primary-foreground [a]:hover:bg-primary-hover",
        secondary:
          "rounded-4xl bg-pane px-3 text-foreground [a]:hover:bg-pane-2",
        // badge-positive: pale green with the deep positive ink
        accent: "rounded-4xl bg-accent px-3 text-accent-foreground",
        warning: "rounded-4xl bg-warning-pill px-3 text-warning-pill-foreground",
        // badge-negative: maroon with white text
        destructive:
          "rounded-4xl bg-negative-pill px-3 text-negative-pill-foreground focus-visible:ring-destructive/20 [a]:hover:opacity-90",
        outline:
          "rounded-4xl border-foreground px-3 text-foreground [a]:hover:bg-pane",
        ghost:
          "rounded-4xl px-3 hover:bg-pane",
        link: "text-foreground underline underline-offset-2",
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
