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
        const tone =
          s.tone === "gain"
            ? "text-accent-brand"
            : s.tone === "loss"
              ? "text-(--chart-negative)"
              : null;
        const wash =
          s.tone === "gain"
            ? "bg-[linear-gradient(160deg,var(--positive-wash),transparent)]"
            : s.tone === "loss"
              ? "bg-[linear-gradient(160deg,var(--negative-wash),transparent)]"
              : null;
        return (
          <div
            key={s.label}
            className={cn(
              "card-surface panel-body-sm",
              wash,
              odd && i === stats.length - 1 && "sm:col-span-2 lg:col-span-1",
            )}
          >
            {/* Sentence case at reading size, not a small-caps eyebrow: on this palette the
                tile's job is done by the wash and the mono figure, so a letterspaced label
                would just add a third thing competing for the top-left corner. */}
            <div className={cn("text-[12.5px]", tone ?? "text-muted-foreground")}>
              {s.label}
            </div>
            {/* A full-width row on a phone fits the figure at nearly full size; from `sm`
                two share the row and it steps up to the design's 22px. `whitespace-nowrap`
                stays either way — a signed VND amount that wraps strands its minus sign on
                a line of its own. */}
            <div
              className={cn(
                "mt-2.5 font-mono text-[19px] font-semibold tracking-[-0.01em] whitespace-nowrap tabular-nums sm:text-[22px]",
                tone,
              )}
            >
              {s.value}
            </div>
            {s.sub && (
              <div className={cn("mt-1.5 text-[11.5px]", tone ?? "text-faint")}>{s.sub}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
