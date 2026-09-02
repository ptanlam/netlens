"use client";

import * as React from "react";
import type { HoldingPnlPoint, PnlPoint } from "@/lib/types";
import { fmtVND } from "@/lib/format";
import {
  MIN_ANNUALIZE_DAYS, holdingPoints, measure, type HoldingDay, type ReturnStats,
} from "@/lib/returns";
import { PanelHead } from "@/components/panel-head";
import { typeColor } from "@/components/portfolio-panels";
import { cn } from "@/lib/utils";

/** A rate as a signed percentage. One decimal: a return is never known to more than that,
 *  and two would invite reading precision into a figure built on daily closes. */
function fmtPct(v: number): string {
  return `${v < 0 ? "−" : "+"}${(Math.abs(v) * 100).toFixed(1)}%`;
}

function toneOf(v: number): string {
  return v >= 0 ? "text-accent-brand" : "text-(--chart-negative)";
}

/** "1 year 3 months", from a day count — the period every figure on the card covers. */
function fmtSpan(days: number): string {
  if (days < 60) return `${days} days`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years}y ${rest}m` : `${years} years`;
}

/** One of the three headline figures. */
function Figure({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: string;
  sub: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[12.5px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-2 font-mono text-[22px] font-semibold tracking-[-0.01em] tabular-nums",
          tone,
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11.5px] text-faint">{sub}</div>
    </div>
  );
}

interface HoldingReturn {
  name: string;
  type: string;
  stats: ReturnStats;
}

/**
 * What the holdings did, what you got, and the difference between the two.
 *
 * Both figures come out of the P&L series this page already fetches (`usePnlHistory`), so
 * the panel costs no query: `PnlPoint` carries the cost basis and the value for every day,
 * which is exactly a time-weighted chain plus a set of dated cashflows.
 *
 * The per-holding list ranks by **your** return rather than by profit. Ranked by profit — as
 * the Holdings panel above necessarily is — the top of the list is just wherever you put the
 * most money; ranked by the rate you actually earned on it, it says which decisions were any
 * good. Only holdings you still own are listed: a closed position's rate is a real figure,
 * but it answers a question about the past, and mixing the two into one ranking would put a
 * position you can still act on beside one you can't.
 */
export function ReturnsCard({
  series,
  holdings,
}: {
  /** The daily reconstruction. Null while it's still loading. */
  series: PnlPoint[] | null;
  /** Per-holding daily breakdown, from the same fetch. */
  holdings: HoldingPnlPoint[] | null;
}) {
  const stats = React.useMemo(() => (series ? measure(series) : null), [series]);

  const perHolding = React.useMemo<HoldingReturn[]>(() => {
    if (!holdings) return [];
    const rows = new Map<string, { type: string; days: HoldingDay[] }>();
    for (const day of holdings) {
      for (const h of day.holdings) {
        const entry = rows.get(h.name) ?? { type: h.type, days: [] };
        entry.days.push({ date: day.date, value: h.value, pnl: h.pnl });
        rows.set(h.name, entry);
      }
    }
    const out: HoldingReturn[] = [];
    for (const [name, { type, days }] of rows) {
      // Still held: a holding whose last day is worth nothing has been sold out.
      if (!days.length || days[days.length - 1].value <= 0) continue;
      const s = measure(holdingPoints(days));
      if (s) out.push({ name, type, stats: s });
    }
    // By the rate you earned, best first — falling back to the cumulative figure for a
    // holding too young to annualize, which sorts it among the others rather than to the end.
    return out.sort((a, b) => (b.stats.mwr ?? b.stats.twr) - (a.stats.mwr ?? a.stats.twr));
  }, [holdings]);

  const info =
    "Time-weighted is what the holdings did, with your contributions divided out — the figure a fund quotes. Money-weighted (XIRR) is the annual rate your own dated cashflows actually earned. The gap is your timing.";

  if (!stats) {
    return (
      <div className="card-surface panel-body">
        <PanelHead title="Returns" info={info} />
        <p className="py-6 text-[13px] text-muted-foreground">
          {series ? "Not enough history yet to measure a return." : "Measuring…"}
        </p>
      </div>
    );
  }

  const short = stats.twrAnnual == null;

  return (
    <div className="card-surface panel-body">
      <PanelHead
        title="Returns"
        info={info}
        actions={
          <span className="font-mono text-[11.5px] text-faint tabular-nums">
            {stats.from} → {stats.to}
          </span>
        }
      />

      {/* Under six months there is no annual rate to quote, so the card quotes the plain
          cumulative one and says so. Compounding a short run into a yearly figure is the
          easiest lie this panel could tell. */}
      {short ? (
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <Figure
            label="Return so far"
            value={fmtPct(stats.twr)}
            tone={toneOf(stats.twr)}
            sub={`Over ${fmtSpan(stats.days)} — not annualized`}
          />
          <Figure
            label="Value vs cost"
            value={fmtVND(stats.value - stats.invested)}
            tone={toneOf(stats.value - stats.invested)}
            sub={`${fmtVND(stats.value)} held against ${fmtVND(stats.invested)} in`}
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-5 sm:grid-cols-3">
          <Figure
            label="Holdings return"
            value={fmtPct(stats.twrAnnual!)}
            tone={toneOf(stats.twrAnnual!)}
            sub={`Time-weighted, per year · ${fmtPct(stats.twr)} over ${fmtSpan(stats.days)}`}
          />
          <Figure
            label="Your return"
            value={stats.mwr == null ? "—" : fmtPct(stats.mwr)}
            tone={stats.mwr == null ? undefined : toneOf(stats.mwr)}
            sub={stats.mwr == null ? "Cashflows don't resolve a rate" : "Money-weighted (XIRR), per year"}
          />
          <Figure
            label="Your timing"
            value={stats.timing == null ? "—" : fmtPct(stats.timing)}
            tone={stats.timing == null ? undefined : toneOf(stats.timing)}
            sub={
              stats.timing == null
                ? "Needs both rates"
                : stats.timing >= 0
                  ? "You bought when it paid to"
                  : "The money arrived at worse prices"
            }
          />
        </div>
      )}

      {perHolding.length > 0 && (
        <div className="mt-5 border-t border-divider-soft pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-semibold">By holding</span>
            <span className="text-[11.5px] text-faint">Ranked by what you earned, not by profit</span>
          </div>
          <div className="mt-2.5 flex flex-col">
            {perHolding.map((h) => {
              const rate = h.stats.mwr ?? h.stats.twr;
              return (
                <div
                  key={h.name}
                  className="flex items-center justify-between gap-3 border-t border-divider-soft py-2.5 first:border-t-0"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="size-[9px] shrink-0 rounded-[2px]"
                      style={{ background: typeColor(h.type) }}
                    />
                    <span className="truncate text-[13.5px]">{h.name}</span>
                  </div>
                  <div className="flex shrink-0 items-baseline gap-3 font-mono tabular-nums">
                    <span className="text-[11.5px] text-faint">{fmtVND(h.stats.value)}</span>
                    <span className={cn("w-[68px] text-right text-[13.5px]", toneOf(rate))}>
                      {fmtPct(rate)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          {/* One footnote rather than a badge per row, and worded to cover both reasons a
              row can be quoting a cumulative figure: too little history to annualize, or
              cashflows that bracket no rate. Saying only the first would explain the wrong
              row half the time. */}
          {perHolding.some((h) => h.stats.mwr == null) && (
            <p className="mt-2.5 text-[11.5px] text-faint">
              Where a holding is younger than {Math.round(MIN_ANNUALIZE_DAYS / 30.44)} months, or
              its cashflows resolve no yearly rate, the figure is its return so far.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
