"use client";

import * as React from "react";
import { fmtVND, MONTHS } from "@/lib/format";
import { PanelHead } from "@/components/panel-head";
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
export function sparkPaths(values: number[], max = 120): { line: string; area: string } | null {
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
 * Net worth, as the design draws it: a compact rail card — label, a 26px mono figure, the
 * day's move under it, and a small sparkline held to the right at a fixed 110px.
 *
 * It was an oversized brand-lit hero spanning the page before. The design deliberately
 * doesn't do that: the dashboard's width belongs to the chart, and the rail is a column of
 * quiet cards. The breakdown that used to sit beside the hero is now the card below this
 * one, which is the same information one step further down the same column.
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

  const formula = hasFunds
    ? "Investments + Savings + Set aside − Debts"
    : "Investments + Savings − Debts";

  return (
    <>
      <section className="card-surface panel-body-sm">
        <PanelHead
          title="Net worth"
          tone="label"
          info={`How this is built: ${formula}. Priced from the latest close each feed has settled.`}
        />
        <div className="mt-2.5 flex items-end gap-3.5">
          <div className="min-w-0 flex-1">
            <div
              key={flash?.n ?? "static"}
              onAnimationEnd={() => setFlash(null)}
              className={cn(
                "font-mono text-[26px] leading-none font-semibold tracking-[-0.02em] whitespace-nowrap tabular-nums will-change-transform",
                flash?.dir === "up" && "animate-nw-flash-up",
                flash?.dir === "down" && "animate-nw-flash-down",
              )}
            >
              {fmtVND(net)}
            </div>
            {todayDelta != null && todayDelta !== 0 && (
              <div
                title={
                  todayFrom
                    ? `Measured against the close of ${fmtDayShort(todayFrom)} — the latest one a price feed has settled. The days since are carried forward at that price, so this move covers all of them.`
                    : undefined
                }
                className={cn(
                  "mt-2 font-mono text-[12px] tabular-nums",
                  todayDelta < 0 ? "text-(--chart-negative)" : "text-accent-brand",
                )}
              >
                {todayDelta < 0 ? "↘ −" : "↗ +"}
                {fmtVND(Math.abs(todayDelta)).replace("-", "")}
                <span className="text-faint">
                  {" "}
                  {todayFrom ? `since ${fmtDayShort(todayFrom)}` : "today"}
                </span>
              </div>
            )}
          </div>
          {/* Fixed 110×44 and held to the right of the figure, per the design — a spark is
              a shape, not a chart, so it doesn't get to claim width from the number. */}
          {paths && (
            <svg
              aria-hidden
              viewBox="0 0 1000 300"
              preserveAspectRatio="none"
              className="animate-fade-in h-11 w-[110px] shrink-0 text-accent-brand"
            >
              <path
                d={paths.line}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
        </div>
      </section>

      <section className="card-surface panel-body-x flex flex-col">
        {parts.map((p, i) => (
          <div
            key={p.label}
            className={cn(
              "flex items-center justify-between gap-3 py-3",
              i < parts.length - 1 && "border-b border-divider",
            )}
          >
            <span className="text-[13px] text-muted-foreground">{p.label}</span>
            <span className={cn("font-mono text-[14px] font-semibold tabular-nums", p.cls)}>
              {p.sign}
              {fmtVND(p.value)}
            </span>
          </div>
        ))}
      </section>
    </>
  );
}
