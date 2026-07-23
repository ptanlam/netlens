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
  // Two-up on a phone, then as many columns as fit. An odd count would otherwise leave the
  // last card stranded at half width with a hole beside it, so it spans the row instead.
  const odd = stats.length % 2 === 1;

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]",
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
              "card-surface px-4 py-[18px] sm:px-6 sm:py-[22px]",
              wash,
              odd && i === stats.length - 1 && "col-span-2 lg:col-span-1",
            )}
          >
            <div
              className={cn(
                "text-[10.5px] font-semibold tracking-[0.14em] uppercase",
                tone ?? "text-faint",
              )}
            >
              {s.label}
            </div>
            {/* Two per row on a phone leaves ~130px of usable width, which a signed
                nine-figure VND amount overruns — it has to shrink rather than wrap, or the
                minus sign ends up stranded on its own line. */}
            <div
              className={cn(
                "mt-3 font-mono text-[15px] font-semibold tracking-[-0.01em] whitespace-nowrap tabular-nums sm:text-[24px]",
                tone,
              )}
            >
              {s.value}
            </div>
            {s.sub && (
              <div className={cn("mt-1.5 text-[12px]", tone ?? "text-muted-foreground")}>
                {s.sub}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
