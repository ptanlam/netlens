import * as React from "react";
import { cn } from "@/lib/utils";

/** A tile whose figure means something good or bad gets washed and coloured by that sign;
 *  a plain magnitude (a count, a cost basis) stays neutral. */
export type StatTone = "gain" | "loss";

export interface Stat {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: StatTone;
  /** A count rather than an amount, so "Hide amounts" leaves it readable. */
  unmask?: boolean;
}

/**
 * The summary strip that opens every page — dashboard, investments, savings, debts.
 *
 * One component rather than a strip per page: they're the same object, and when they were
 * hand-rolled the four drifted apart (different paddings, different type sizes, and only
 * some of them washing the signed tiles).
 */
export function SummaryCards({ stats, className }: { stats: Stat[]; className?: string }) {
  // One per row on a phone, two from `sm`, then as many columns as fit. Two-up on a phone
  // squeezed a nine-figure VND amount into ~130px and left an odd count stranded at half
  // width with a hole beside it — a full-width row reads cleanly and costs only scroll,
  // which a phone has plenty of. From `sm` the odd last card spans the row instead.
  const odd = stats.length % 2 === 1;

  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]",
        className,
      )}
    >
      {stats.map((s, i) => {
        // Wise cards are flat white. The sign colours the figure and the line under it, and
        // there's no background wash: on this palette a tinted card reads as an alert.
        const tone =
          s.tone === "gain"
            ? "text-accent-brand"
            : s.tone === "loss"
              ? "text-destructive"
              : null;
        return (
          <div
            key={s.label}
            className={cn(
              "card-surface panel-body-sm flex flex-col gap-2",
              odd && i === stats.length - 1 && "sm:col-span-2 lg:col-span-1",
            )}
          >
            <div className="text-body-sm text-muted-foreground">{s.label}</div>
            {/* Wise's 24px sub-display: Inter 600 with tight tracking. `whitespace-nowrap`
                keeps a signed VND amount from stranding its minus sign on a line of its own. */}
            <div
              data-unmask={s.unmask || undefined}
              className={cn(
                "font-mono text-body-lg leading-[1.3] font-semibold tracking-[-0.02em] whitespace-nowrap sm:text-display-xs",
                tone,
              )}
            >
              {s.value}
            </div>
            {s.sub && (
              <div className={cn("text-body-sm font-semibold", tone ?? "text-muted-foreground")}>{s.sub}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
