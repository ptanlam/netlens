"use client";

import * as React from "react";
import { fmtVND, MONTHS } from "@/lib/format";
import { TrendingDown, TrendingUp } from "lucide-react";
import { IconTooltip } from "@/components/ui/tooltip";
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
 * Net worth, as the Netlens Dashboard design draws it: the one inverse surface on the page.
 * An ink card, full width, with the figure in the heavy display face in Wise Green, the day's move
 * as a badge in the corner, and the formula's parts in a row under a hairline.
 *
 * It opens the page on purpose. Net worth is the question the dashboard exists to answer,
 * so it takes the full width and the brand's loudest type, and everything below it is
 * detail on that one figure.
 */
export function NetWorthPanel({
  investments,
  savings,
  funds,
  debts,
  todayDelta,
  todayFrom,
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
}) {
  const net = investments + savings + funds - debts;

  // Flash the figure — up or down — whenever it moves. A price refresh re-renders this
  // panel with a new total; we compare against the last one we showed and, on a real
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

  // The set-aside line only earns its place once there's something in it — an empty row on
  // every dashboard would be noise for anyone not saving up for anything. Rounded, so a
  // fund that's been spent down to sub-₫1 dust doesn't leave a "₫0" line behind.
  const hasFunds = Math.round(funds) !== 0;
  const parts = [
    { label: "Investments", value: investments },
    { label: "+ Savings", value: savings },
    ...(hasFunds ? [{ label: "+ Set aside", value: funds }] : []),
    { label: "− Debts", value: debts },
  ];

  const formula = hasFunds
    ? "Investments + Savings + Set aside − Debts"
    : "Investments + Savings − Debts";

  // The move as a share of what the figure was before it. Guarded against a zero baseline —
  // a first-ever day with nothing behind it would divide by zero and render "Infinity%".
  const before = todayDelta != null ? net - todayDelta : null;
  const todayPct =
    todayDelta != null && before != null && before !== 0 ? (todayDelta / Math.abs(before)) * 100 : null;

  return (
    <section className="@container flex flex-col gap-6 rounded-3xl bg-hero p-6 text-hero-foreground sm:gap-8 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-body font-semibold">Net worth</span>
          <IconTooltip label={`How this is built: ${formula}. Priced from the latest close each feed has settled.`}>
            <button
              type="button"
              aria-label="About net worth"
              className="grid size-[18px] cursor-help place-items-center rounded-full bg-hero-divider text-caption leading-none font-semibold text-hero-foreground"
            >
              i
            </button>
          </IconTooltip>
        </div>
        {/* The day's move, as the design's badge. The percentage is of the figure directly
            below, so it can be checked against what's on screen. */}
        {todayDelta != null && todayDelta !== 0 && (
          <div
            title={
              todayFrom
                ? `Measured against the close of ${fmtDayShort(todayFrom)} — the latest one a price feed has settled. The days since are carried forward at that price, so this move covers all of them.`
                : undefined
            }
            className={cn(
              "inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-2xl px-3 py-1 font-mono text-body-sm font-semibold",
              todayDelta < 0 ? "bg-hero-neg-bg text-hero-neg-fg" : "bg-hero-pos-bg text-hero-pos-fg",
            )}
          >
            {todayDelta < 0 ? (
              <TrendingDown className="size-4 shrink-0" />
            ) : (
              <TrendingUp className="size-4 shrink-0" />
            )}
            <span className="whitespace-nowrap">
              {todayDelta < 0 ? "−" : "+"}
              {fmtVND(Math.abs(todayDelta)).replace("-", "")}
            </span>
            {todayPct != null && (
              <span className="font-semibold opacity-80">
                ({todayPct < 0 ? "−" : "+"}
                {Math.abs(todayPct).toFixed(2)}%)
              </span>
            )}
            <span className="font-semibold whitespace-nowrap opacity-80">
              {todayFrom ? `since ${fmtDayShort(todayFrom)}` : "today"}
            </span>
          </div>
        )}
      </div>

      <div
        key={flash?.n ?? "static"}
        data-amount
        onAnimationEnd={() => setFlash(null)}
        className={cn(
          // Sized off the card's own width (`cqi`), so the figure stays on one line from a
          // phone up to the design's 96px on a wide screen.
          "font-display text-[clamp(34px,10.5cqi,96px)] leading-[0.85] font-black tracking-[-0.01em] whitespace-nowrap text-hero-accent tabular-nums will-change-transform",
          "[--nw-down:var(--hero-neg-fg)] [--nw-rest:var(--hero-accent)] [--nw-up:var(--hero-strong)]",
          flash?.dir === "up" && "animate-nw-flash-up",
          flash?.dir === "down" && "animate-nw-flash-down",
        )}
      >
        {fmtVND(net)}
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-4 border-t border-hero-divider pt-6 min-[480px]:grid-cols-2 @3xl:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
        {parts.map((p) => (
          <div key={p.label} className="flex flex-col gap-1">
            <span className="text-body-sm">{p.label}</span>
            <span className="font-mono text-body-lg font-semibold whitespace-nowrap text-hero-strong sm:text-body-lg">
              {fmtVND(p.value)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
