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

  // The move as a share of what the figure was before it. Guarded against a zero baseline —
  // a first-ever day with nothing behind it would divide by zero and render "Infinity%".
  const before = todayDelta != null ? net - todayDelta : null;
  const todayPct =
    todayDelta != null && before != null && before !== 0 ? (todayDelta / Math.abs(before)) * 100 : null;

  return (
    <>
      <section className="@container card-surface panel-body-sm">
        <PanelHead
          title="Net worth"
          tone="label"
          info={`How this is built: ${formula}. Priced from the latest close each feed has settled.`}
        />
        <div className="mt-2.5 flex items-end gap-3.5 @xl:mt-4 @xl:gap-6">
          <div className="min-w-0 flex-1">
            <div
              key={flash?.n ?? "static"}
              onAnimationEnd={() => setFlash(null)}
              className={cn(
                // Sized by the card's own width, not the window's: this panel sits in the
                // dashboard's narrow rail but goes full measure once the rail wraps, and
                // the figure has to stay on one line in both.
                "font-mono text-[26px] leading-none font-semibold tracking-[-0.02em] whitespace-nowrap tabular-nums will-change-transform @xl:text-[38px] @3xl:text-[46px]",
                flash?.dir === "up" && "animate-nw-flash-up",
                flash?.dir === "down" && "animate-nw-flash-down",
              )}
            >
              {fmtVND(net)}
            </div>
            {/* The day's move, as a tinted pill rather than a line of small text. It's the
                second thing you come to this panel for, and at 12px beside a 46px figure it
                read as a caption on the number instead of a figure of its own. */}
            {todayDelta != null && todayDelta !== 0 && (
              <div
                title={
                  todayFrom
                    ? `Measured against the close of ${fmtDayShort(todayFrom)} — the latest one a price feed has settled. The days since are carried forward at that price, so this move covers all of them.`
                    : undefined
                }
                className={cn(
                  "mt-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[12px] whitespace-nowrap tabular-nums @xl:mt-3.5 @xl:px-3 @xl:text-[13.5px]",
                  todayDelta < 0
                    ? "bg-negative-wash text-(--chart-negative)"
                    : "bg-accent text-accent-brand",
                )}
              >
                <span className="font-semibold">
                  {todayDelta < 0 ? "↘ −" : "↗ +"}
                  {fmtVND(Math.abs(todayDelta)).replace("-", "")}
                </span>
                {/* Percent of the figure directly above: it moved by the amount shown, so
                    this is that amount over what it was. Self-consistent with what's on
                    screen rather than measured against a total the panel doesn't name. */}
                {todayPct != null && (
                  <span className="opacity-80">
                    ({todayPct < 0 ? "−" : "+"}
                    {Math.abs(todayPct).toFixed(2)}%)
                  </span>
                )}
                <span className="opacity-70">
                  {todayFrom ? `since ${fmtDayShort(todayFrom)}` : "today"}
                </span>
              </div>
            )}
          </div>
          {/* Held to the right of the figure at a fixed size, per the design — a spark is a
              shape, not a chart, so it doesn't get to claim width from the number. On a
              narrow card it's dropped entirely rather than squeezed: the figure and the
              day's move are what the panel is for, and the full history is one panel down. */}
          {paths && (
            <svg
              aria-hidden
              viewBox="0 0 1000 300"
              preserveAspectRatio="none"
              className="animate-fade-in hidden h-11 w-[110px] shrink-0 text-accent-brand @xs:block @xl:h-16 @xl:w-[200px] @3xl:w-[280px]"
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

      <section className="@container card-surface panel-body-x">
        {/* The flex row lives on an inner element on purpose: a container query can't ask
            about the element that *declares* the container, only about an ancestor one. */}
        <div className="flex flex-col @xl:flex-row @xl:items-stretch">
          {parts.map((p, i) => (
            <div
              key={p.label}
              className={cn(
                // Stacked rows in a rail; side by side once the card is wide enough that a
                // list of three would leave most of its width empty.
                "flex items-center justify-between gap-3 py-3 @xl:flex-1 @xl:flex-col @xl:items-start @xl:justify-center @xl:gap-1.5 @xl:px-4 @xl:py-1 @xl:first:pl-0 @xl:last:pr-0",
                i < parts.length - 1 && "border-b border-divider @xl:border-b-0 @xl:border-r",
              )}
            >
              <span className="text-[13px] text-muted-foreground">{p.label}</span>
              <span className={cn("font-mono text-[14px] font-semibold tabular-nums @xl:text-[17px]", p.cls)}>
                {p.sign}
                {fmtVND(p.value)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
