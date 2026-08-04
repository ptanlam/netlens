"use client";

import * as React from "react";
import { fmtVND, MONTHS } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "2026-07-30" → "Jul 30". Sliced rather than passed through `Date`, which would read the
 *  ISO day as UTC midnight and shift it a day back in every timezone behind it. */
function fmtDayShort(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/** Down-sample to at most N points and turn them into a line + closed area path over a
 *  1000×300 viewBox. The spark is drawn with `preserveAspectRatio="none"`, so the x scale
 *  is whatever the card is wide — only the shape has to be right. */
function sparkPaths(values: number[], max = 120): { line: string; area: string } | null {
  if (values.length < 2) return null;
  const step = Math.max(1, Math.ceil(values.length / max));
  const pts = values.filter((_, i) => i % step === 0 || i === values.length - 1);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  const x = (i: number) => ((i / (pts.length - 1)) * 1000).toFixed(1);
  // Insets at both ends: the top one keeps the 2px stroke off the clip at the peak, and the
  // bottom one stops a long flat run at the series minimum from collapsing onto the
  // baseline, where the fill has no height and the line reads as a missing chart.
  const y = (v: number) => (8 + (1 - (v - lo) / span) * 232).toFixed(1);
  const line = pts.map((v, i) => `${i ? "L" : "M"} ${x(i)} ${y(v)}`).join(" ");
  return { line, area: `${line} L 1000 300 L 0 300 Z` };
}

/**
 * The dashboard hero: net worth as a single oversized figure on a brand-lit card, with the
 * components it's made of on a rail beside it. Two cards rather than one so the rail keeps
 * its own edges at every width — below `lg` it stacks underneath.
 */
export function NetWorthPanel({
  investments,
  savings,
  funds,
  debts,
  todayDelta,
  todayFrom,
  spark,
}: {
  investments: number;
  savings: number;
  /** Money set aside in sinking funds. Still yours until you spend it, so it counts. */
  funds: number;
  debts: number;
  /** Day-over-day P&L move; null while the series is still loading. */
  todayDelta?: number | null;
  /** Set only when `todayDelta` spans more than a day — the date it's measured from,
   *  because a feed hasn't settled a close since. Labels the badge honestly instead of
   *  letting a multi-day move read as today's. */
  todayFrom?: string | null;
  /** Portfolio value history, for the sparkline under the figure. */
  spark?: number[] | null;
}) {
  const net = investments + savings + funds - debts;

  // Flash the figure — green up, red down — whenever it moves. A price refresh re-renders
  // this panel with a new total; we compare against the last one we showed and, on a real
  // change, restart the tick animation (bumping `n` remounts the node so it replays even on
  // back-to-back refreshes). First mount seeds `prev` with the current value, so nothing
  // flashes on load. `onAnimationEnd` clears the state; reduced-motion users just see the
  // number update, since the animation utilities are gated behind that media query.
  const prev = React.useRef(net);
  const seq = React.useRef(0);
  const [flash, setFlash] = React.useState<{ dir: "up" | "down"; n: number } | null>(null);
  React.useEffect(() => {
    if (net === prev.current) return;
    const dir = net > prev.current ? "up" : "down";
    prev.current = net;
    seq.current += 1;
    setFlash({ dir, n: seq.current });
  }, [net]);

  // The set-aside line only earns its place once there's something in it — an empty rail
  // row on every dashboard would be noise for anyone not saving up for anything. Rounded,
  // so a fund that's been spent down to sub-₫1 dust doesn't leave a "₫0" line behind.
  const hasFunds = Math.round(funds) !== 0;
  const parts = [
    { label: "Investments", value: investments, sign: "", cls: "text-foreground" },
    { label: "Savings", value: savings, sign: "+", cls: "text-accent-brand" },
    ...(hasFunds
      ? [{ label: "Set aside", value: funds, sign: "+", cls: "text-accent-brand" }]
      : []),
    { label: "Debts", value: debts, sign: "−", cls: "text-(--chart-negative)" },
  ];

  const paths = spark ? sparkPaths(spark) : null;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.9fr_1fr]">
      <div className="card-surface relative flex flex-col overflow-hidden px-7 pt-8 sm:px-9">
        {/* Brand light spilling in from the top-left corner — the only decoration on the
            page, and what makes the hero read as the hero. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_12%_0%,var(--brand-soft),transparent_55%)]"
        />
        <div className="relative">
          {/* Sentence case at reading size — the design labels its figures rather than
              badging them, and a letterspaced eyebrow over a 76px number reads as two
              headings stacked. */}
          <div className="text-[13px] text-muted-foreground">Net worth</div>
          <div className="mt-3.5 flex flex-wrap items-end gap-4">
            <div
              key={flash?.n ?? "static"}
              data-hero-number
              onAnimationEnd={() => setFlash(null)}
              className={cn(
                "font-mono text-[clamp(2.75rem,7vw,4.75rem)] leading-[0.92] font-semibold tracking-[-0.03em] text-foreground tabular-nums will-change-transform",
                flash?.dir === "up" && "animate-nw-flash-up",
                flash?.dir === "down" && "animate-nw-flash-down",
              )}
            >
              {fmtVND(net)}
            </div>
            {/* Direction arrow, shown only while a refresh's flash is playing — same
                green/red cue as the figure, so the move reads at a glance. Sibling (not
                child) of the number so its own animation-end never clears the flash. */}
            {flash && (
              <span
                aria-hidden
                className={cn(
                  "animate-fade-in mb-2 font-mono text-[26px] leading-none sm:text-[32px]",
                  flash.dir === "up" ? "text-accent-brand" : "text-(--chart-negative)",
                )}
              >
                {flash.dir === "up" ? "▲" : "▼"}
              </span>
            )}
          </div>
          {/* The day's move sits under the figure rather than beside it: alongside, it had
              to bottom-align against a number whose size is fluid (clamp), so the two never
              quite sat right, and on a narrow card it wrapped to its own line anyway. */}
          <div className="mt-4 flex flex-wrap items-center gap-x-3.5 gap-y-2">
            {todayDelta != null && todayDelta !== 0 && (
              <span
                title={
                  todayFrom
                    ? `Measured against the close of ${fmtDayShort(todayFrom)} — the latest one a price feed has settled. The days since are carried forward at that price, so this move covers all of them.`
                    : undefined
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold tabular-nums",
                  todayDelta < 0
                    ? "bg-negative-wash text-(--chart-negative)"
                    : "bg-accent text-accent-brand",
                )}
              >
                {/* The explicit spaces are load-bearing: these are all text nodes, so they
                    merge into one anonymous flex item and the pill's `gap` never applies. */}
                {todayDelta < 0 ? "▾" : "▴"}{" "}
                {todayFrom ? `Since ${fmtDayShort(todayFrom)}` : "Today"}{" "}
                {todayDelta < 0 ? "−" : "+"}
                {fmtVND(Math.abs(todayDelta)).replace("-", "")}
              </span>
            )}
            <span className="text-[13.5px] text-muted-foreground">
              {hasFunds
                ? "Investments + Savings + Set aside − Debts"
                : "Investments + Savings − Debts"}
            </span>
          </div>
        </div>

        {/* Bleeds into the card's bottom edge, so the negative margins have to cancel the
            card padding exactly — anything less leaves a strip of surface under the fill. */}
        {paths ? (
          <svg
            aria-hidden
            viewBox="0 0 1000 300"
            preserveAspectRatio="none"
                        // Gain-green, matching the design's net-worth spark — blue is the action
            // colour on this palette, and the hero already spends it on the corner light.
            className="animate-fade-in relative mt-4 -mb-px block h-[110px] w-[calc(100%+3.5rem)] -translate-x-7 text-accent-brand opacity-60 sm:w-[calc(100%+4.5rem)] sm:-translate-x-9"
          >
            <defs>
              <linearGradient id="nw-spark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.35" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={paths.area} fill="url(#nw-spark)" />
            <path
              d={paths.line}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : (
          <div className="h-[110px]" />
        )}
      </div>

      <div className="card-surface flex flex-col justify-center px-7">
        {parts.map((p, i) => (
          <div
            key={p.label}
            className={cn(
              "flex items-center justify-between py-5",
              i < parts.length - 1 && "border-b border-divider",
            )}
          >
            <span className="text-[13px] text-muted-foreground">{p.label}</span>
            <span className={cn("font-mono text-[19px] font-semibold tabular-nums", p.cls)}>
              {p.sign}
              {fmtVND(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
