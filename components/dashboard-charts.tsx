"use client";

import * as React from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { HoldingPnlPoint, Payload, PnlPoint } from "@/lib/types";
import { fmtVND, MONTHS } from "@/lib/format";
import { NetWorthPanel } from "@/components/net-worth";
import { GoalStrip } from "@/components/goal-strip";
import { SummaryCards, type Stat } from "@/components/stat-card";
import type { GoalView } from "@/lib/goals";
import { PortfolioChart } from "@/components/portfolio-chart";
import { PnlCalendar } from "@/components/pnl-calendar";
import { usePriceRefreshCount } from "@/components/live-prices";
import { cn } from "@/lib/utils";

/** Fixed slot per asset type — colour follows the entity, never its rank. */
const TYPE_COLORS: Record<string, string> = {
  Funds: "var(--chart-1)",
  Stocks: "var(--chart-2)",
  Crypto: "var(--chart-3)",
  "Real Estate": "var(--chart-4)",
};
const typeColor = (t: string) => TYPE_COLORS[t] ?? "var(--chart-5)";

/** Short VND for bars/legends: ₫372tr, ₫22tr. */
function fmtTrVND(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${v < 0 ? "−" : ""}₫${Math.round(abs / 1e6)}tr`;
  return `${v < 0 ? "−" : ""}₫${Math.round(abs / 1e3)}k`;
}
function fmtSigned(v: number): string {
  return `${v < 0 ? "−" : "+"}₫${Math.abs(Math.round(v)).toLocaleString("de-DE")}`;
}

/** A price refresh can only move *today* — every earlier day is settled history. So the
 *  latest point is spliced onto the series we already have rather than refetched. */
function withLatest<T extends { date: string }>(prev: T[], tail: T[]): T[] {
  if (!tail.length) return prev;
  const latest = tail[tail.length - 1];
  if (!prev.length) return [latest];
  const last = prev[prev.length - 1];
  if (last.date === latest.date) return [...prev.slice(0, -1), latest];
  if (latest.date > last.date) return [...prev, latest]; // tab left open past midnight
  return prev;
}

export function DashboardCharts({
  payload,
  savings,
  funds,
  debts,
  pending,
  goals,
}: {
  payload: Payload;
  savings: number;
  funds: number;
  debts: number;
  pending: number;
  goals: GoalView[];
}) {
  const [series, setSeries] = React.useState<PnlPoint[] | null>(null);
  const [holdingSeries, setHoldingSeries] = React.useState<HoldingPnlPoint[] | null>(null);
  const [seriesError, setSeriesError] = React.useState<string | null>(null);
  const refreshCount = usePriceRefreshCount();
  const loaded = series !== null;

  React.useEffect(() => {
    let alive = true;
    fetch("/api/pnl-history")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { series: PnlPoint[]; holdings: HoldingPnlPoint[] }) => {
        if (!alive) return;
        setSeries(d.series);
        setHoldingSeries(d.holdings);
      })
      .catch((e: Error) => alive && setSeriesError(e.message));
    return () => { alive = false; };
  }, []);

  // Prices moved, so today's P&L moved with them — re-pull just that day and splice it
  // in. Waits on `loaded` so the refresh fired on app open still lands (it usually
  // completes while the first, full history fetch is still in flight).
  React.useEffect(() => {
    if (!refreshCount || !loaded) return;
    let alive = true;
    fetch("/api/pnl-history?today=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { series: PnlPoint[]; holdings: HoldingPnlPoint[] }) => {
        if (!alive) return;
        setSeries((s) => (s ? withLatest(s, d.series) : s));
        setHoldingSeries((h) => (h ? withLatest(h, d.holdings) : h));
      })
      .catch(() => {}); // a failed top-up just leaves the last good point on screen
    return () => { alive = false; };
  }, [refreshCount, loaded]);

  // Today's move + this-month total, derived from the cumulative P&L series.
  const { todayDelta, monthPnl, monthLabel } = React.useMemo(() => {
    if (!series || series.length === 0)
      return { todayDelta: null as number | null, monthPnl: 0, monthLabel: "" };
    const last = series[series.length - 1];
    const today = series.length >= 2 ? last.pnl - series[series.length - 2].pnl : last.pnl;
    const mk = last.date.slice(0, 7);
    let prevMonthEnd = 0;
    for (const p of series) if (p.date.slice(0, 7) < mk) prevMonthEnd = p.pnl;
    const [y, m] = mk.split("-").map(Number);
    return { todayDelta: today, monthPnl: last.pnl - prevMonthEnd, monthLabel: `${MONTHS[m - 1]} ${y}` };
  }, [series]);

  const pnlPct = payload.investedTotal ? (payload.pnl / payload.investedTotal) * 100 : 0;

  // No "Portfolio value" tile here, unlike the Investments page: the hero's rail already
  // carries that exact figure as its Investments row, directly above this strip.
  const kpis: Stat[] = [
    { label: "Total invested", value: fmtVND(payload.investedTotal), sub: "Cost basis, all time" },
    {
      label: "Total P&L",
      value: `${payload.pnl >= 0 ? "+" : "−"}₫${Math.abs(Math.round(payload.pnl)).toLocaleString("de-DE")}`,
      tone: payload.pnl >= 0 ? "gain" : "loss",
      sub: `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% of invested`,
    },
    {
      label: "This month P&L",
      value: series ? fmtSigned(monthPnl) : "—",
      tone: monthPnl >= 0 ? "gain" : "loss",
      sub: monthLabel ? `${monthLabel}, unrealized` : "unrealized",
    },
  ];

  return (
    <div className="flex flex-col gap-3 sm:gap-5">
      <NetWorthPanel
        investments={payload.portfolioTotal}
        savings={savings}
        funds={funds}
        debts={debts}
        todayDelta={todayDelta}
        spark={series?.map((p) => p.value) ?? null}
      />

      <SummaryCards stats={kpis} />

      <GoalStrip goals={goals} />

      {pending > 0 && (
        <Link
          href="/investments"
          className="flex items-start gap-2.5 rounded-2xl border border-warning-border bg-warning-bg px-5 py-4 transition-colors hover:border-warning"
        >
          <TriangleAlert className="mt-0.5 size-4 text-warning" />
          <div>
            <div className="text-[13.5px] font-semibold">
              {pending} fund purchase{pending > 1 ? "s" : ""} awaiting unit confirmation
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              Enter the confirmed units on the Investments page so live valuation stays accurate.
            </div>
          </div>
        </Link>
      )}

      <PortfolioChart series={series} error={seriesError} />

      {/* Current portfolio */}
      <div className="mt-4">
        <div className="text-[26px] font-bold tracking-[-0.01em]">Current portfolio</div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          Live snapshot across all years — independent of the selected range
        </div>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-3 sm:gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <AllocationCard payload={payload} />
        <HoldingsCard payload={payload} />
      </div>

      <PnlByHoldingCard payload={payload} />

      <PnlCalendar series={series} holdings={holdingSeries} error={seriesError} />
    </div>
  );
}

function AllocationCard({ payload }: { payload: Payload }) {
  const total = payload.allocation.reduce((a, x) => a + x.value, 0) || 1;
  const rows = payload.allocation
    .slice()
    .sort((a, b) => b.value - a.value)
    .map((a) => ({ ...a, pct: (a.value / total) * 100, color: typeColor(a.type) }));

  // Donut geometry: a stroked ring with one dash-arc per slice, drawn from 12 o'clock.
  // Prefix pcts (n ≤ 5) give each arc its start offset without mutating across the map.
  const SIZE = 172;
  const STROKE = 26;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;

  return (
    <div className="flex h-full flex-col card-surface px-5 py-6 sm:px-[30px] sm:py-[26px]">
      <div className="text-[17px] font-bold">Allocation</div>
      <div className="mt-0.5 mb-5 text-[12px] text-muted-foreground">Current value by asset type</div>
      <div className="mb-[22px] flex justify-center">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="animate-fade-in">
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {rows.map((r, i) => {
              const start = rows.slice(0, i).reduce((s, x) => s + x.pct, 0);
              const len = (r.pct / 100) * C;
              return (
                <circle
                  key={r.type}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  fill="none"
                  stroke={r.color}
                  strokeWidth={STROKE}
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-(start / 100) * C}
                />
              );
            })}
          </g>
          <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" fill="var(--faint)" className="font-mono" style={{ fontSize: 9.5, letterSpacing: "0.08em" }}>
            TOTAL
          </text>
          <text x="50%" y="59%" textAnchor="middle" dominantBaseline="middle" fill="var(--foreground)" className="font-mono tabular-nums" style={{ fontSize: 15 }}>
            {fmtTrVND(total)}
          </text>
        </svg>
      </div>
      <div className="flex flex-col">
        {rows.map((r, i) => (
          <div key={r.type} className={cn("flex items-center justify-between py-[9px]", i < rows.length - 1 && "border-b border-divider")}>
            <div className="flex items-center gap-2.5">
              <span className="size-[9px] rounded-[2px]" style={{ background: r.color }} />
              <span className="text-[13px]">{r.type}</span>
            </div>
            <div className="flex gap-3.5">
              <span className="font-mono text-[12.5px] text-muted-foreground tabular-nums">{fmtTrVND(r.value)}</span>
              <span className="w-[42px] text-right font-mono text-[12.5px] tabular-nums">{r.pct.toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HoldingsCard({ payload }: { payload: Payload }) {
  const rows = payload.portfolio
    .filter((p) => p.value > 0)
    .slice()
    .sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div className="flex h-full flex-col card-surface px-5 py-6 sm:px-[30px] sm:py-[26px]">
      <div className="text-[17px] font-bold">Holdings</div>
      <div className="mt-0.5 mb-5 text-[12px] text-muted-foreground">Position values, largest first</div>
      <div className="flex flex-col gap-[11px]">
        {rows.map((h, i) => (
          <div key={h.name} className="flex items-center gap-3">
            <div className="w-[104px] truncate text-right font-mono text-[12px]" title={h.name}>{h.name}</div>
            <div className="relative h-[18px] flex-1 rounded bg-background">
              <div
                className="animate-grow-x absolute top-0 left-0 h-full rounded"
                style={{ width: `${(h.value / max) * 100}%`, background: typeColor(h.type), animationDelay: `${i * 45}ms` }}
              />
            </div>
            <div className="w-14 text-right font-mono text-[12px] text-muted-foreground tabular-nums">{fmtTrVND(h.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PnlByHoldingCard({ payload }: { payload: Payload }) {
  const rows = payload.portfolio
    .filter((p) => p.pnl !== 0)
    .slice()
    .sort((a, b) => b.pnl - a.pnl);

  if (rows.length === 0) {
    return (
      <div className="card-surface px-5 py-6 sm:px-[30px] sm:py-[26px]">
        <div className="text-[17px] font-bold">Profit &amp; loss by holding</div>
        <p className="py-8 text-center text-sm text-muted-foreground">
          No gains or losses yet — set live quantities or holding values to see P&amp;L.
        </p>
      </div>
    );
  }

  const maxPos = Math.max(0, ...rows.map((r) => r.pnl));
  const maxNeg = Math.max(0, ...rows.map((r) => -r.pnl));
  const span = maxPos + maxNeg || 1;
  const zeroPct = (maxNeg / span) * 100;

  return (
    <div className="card-surface px-5 py-6 sm:px-[30px] sm:py-[26px]">
      <div className="text-[17px] font-bold">Profit &amp; loss by holding</div>
      <div className="mt-0.5 mb-5 text-[12px] text-muted-foreground">Total gain / loss per position, net of any proceeds</div>
      <div className="flex flex-col gap-2.5">
        {rows.map((p, i) => {
          const neg = p.pnl < 0;
          const w = neg ? (Math.abs(p.pnl) / (maxNeg || 1)) * zeroPct : (p.pnl / (maxPos || 1)) * (100 - zeroPct);
          const left = neg ? zeroPct - w : zeroPct;
          const color = neg ? "var(--chart-negative)" : "var(--chart-positive)";
          return (
            <div key={p.name} className="flex items-center gap-3">
              <div className="w-[104px] truncate text-right font-mono text-[12px]" title={p.name}>{p.name}</div>
              <div className="relative h-[18px] flex-1">
                <div className="absolute -top-[3px] -bottom-[3px] w-px bg-input" style={{ left: `${zeroPct}%` }} />
                {/* Grow out from the zero line: negatives anchor right, positives left. */}
                <div
                  className="animate-grow-x absolute top-0 h-full rounded-[3px]"
                  style={{ left: `${left}%`, width: `${w}%`, background: color, transformOrigin: neg ? "right" : "left", animationDelay: `${i * 45}ms` }}
                />
              </div>
              {/* Wide enough for a signed 8-figure VND amount, or the sign wraps onto its own line. */}
              <div className="w-[94px] shrink-0 text-right font-mono text-[12px] whitespace-nowrap tabular-nums" style={{ color }}>
                {fmtSigned(p.pnl)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
