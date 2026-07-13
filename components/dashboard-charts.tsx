"use client";

import * as React from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type { HoldingPnlPoint, Payload, PnlPoint } from "@/lib/types";
import { fmtVND, MONTHS } from "@/lib/format";
import { NetWorthPanel } from "@/components/net-worth";
import { PortfolioChart } from "@/components/portfolio-chart";
import { PnlCalendar } from "@/components/pnl-calendar";
import { usePriceRefreshCount } from "@/components/live-prices";
import { cn } from "@/lib/utils";

/** Fixed slot per asset type — colour follows the entity, never its rank. */
const TYPE_COLORS: Record<string, string> = {
  Funds: "#c2b48f",
  Stocks: "#2b2924",
  Crypto: "#c07a3f",
  "Real Estate": "#857f70",
};
const typeColor = (t: string) => TYPE_COLORS[t] ?? "#2f7d55";

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
  debts,
  pending,
}: {
  payload: Payload;
  savings: number;
  debts: number;
  pending: number;
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

  // Activity (YTD) figures from contributions.
  const activity = React.useMemo(() => {
    const now = new Date(payload.generated);
    const year = now.getFullYear();
    const ytd = payload.contributions.filter((c) => c.date.slice(0, 4) === String(year));
    const total = ytd.reduce((a, c) => a + c.amount, 0);
    const byMonth = new Map<number, number>();
    for (const c of ytd) {
      const m = Number(c.date.slice(5, 7));
      byMonth.set(m, (byMonth.get(m) ?? 0) + c.amount);
    }
    const thisYear = year === new Date().getFullYear();
    const monthsElapsed = thisYear ? new Date().getMonth() + 1 : 12;
    let best: { m: number; v: number } | null = null;
    for (const [m, v] of byMonth) if (!best || v > best.v) best = { m, v };
    return {
      ytd,
      total,
      avg: total / Math.max(1, monthsElapsed),
      bestLabel: best ? `${MONTHS[best.m - 1]} · ${fmtVND(best.v)}` : "—",
    };
  }, [payload]);

  const kpis: {
    label: string;
    value: string;
    sub?: string;
    emph?: boolean;
    positive?: boolean;
    subEmph?: boolean;
  }[] = [
    { label: "Portfolio value", value: fmtVND(payload.portfolioTotal), sub: "Live · quantity × price" },
    { label: "Total invested", value: fmtVND(payload.investedTotal), sub: "Cost basis, all time" },
    {
      label: "Total P&L",
      value: `${payload.pnl >= 0 ? "+" : "−"}₫${Math.abs(Math.round(payload.pnl)).toLocaleString("de-DE")}`,
      emph: true,
      positive: payload.pnl >= 0,
      sub: `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% of invested`,
      subEmph: true,
    },
    {
      label: "This month P&L",
      value: series ? fmtSigned(monthPnl) : "—",
      emph: true,
      positive: monthPnl >= 0,
      sub: monthLabel ? `${monthLabel}, unrealized` : "unrealized",
    },
  ];

  return (
    <div>
      <NetWorthPanel
        investments={payload.portfolioTotal}
        savings={savings}
        debts={debts}
        todayDelta={todayDelta}
      />

      {/* KPI strip — the two P&L tiles are emphasized, tinted by sign (gain/loss). */}
      <div className="mt-[30px] grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4">
        {kpis.map((k, i) => {
          const tone = k.positive ? "text-accent-brand" : "text-(--chart-negative)";
          const tint = k.emph ? (k.positive ? "bg-[#eef5f1]" : "bg-[#fbeeeb]") : "";
          // Divider to the right: tint it when it sits between two emphasized
          // tiles, so a rust/green wash isn't split by a muddy neutral gray line.
          const between = k.emph && kpis[i + 1]?.emph;
          const divider = between ? (k.positive ? "border-[#d9e8df]" : "border-[#f0d9d3]") : "border-[#edeae3]";
          return (
            <div key={k.label} className={cn("px-4 py-4 sm:px-5 sm:py-[18px]", tint, divider, i < 3 && "lg:border-r", i % 2 === 0 && "border-r lg:border-r")}>
              <div className={cn("font-mono text-[10.5px] tracking-[0.08em] uppercase", k.emph ? cn("font-semibold", tone) : "text-[#a5a29a]")}>{k.label}</div>
              <div
                className={cn(
                  "mt-[7px] font-mono tracking-[-0.01em] tabular-nums",
                  k.emph
                    ? cn("text-[19px] font-semibold sm:text-[26px]", tone)
                    : "text-[17px] sm:text-[22px]",
                )}
              >
                {k.value}
              </div>
              {k.sub && (
                <div className={cn("mt-[3px] text-[11.5px]", k.subEmph ? cn("font-semibold", tone) : "text-muted-foreground")}>
                  {k.sub}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pending > 0 && (
        <Link
          href="/investments"
          className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#e0c9a0] bg-card px-4 py-3.5 transition-colors hover:bg-muted"
        >
          <TriangleAlert className="mt-0.5 size-4 text-[#c07a3f]" />
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

      {/* Activity cards */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ActivityCard label="Invested YTD" value={fmtVND(activity.total)} />
        <ActivityCard label="Monthly average" value={fmtVND(activity.avg)} />
        <ActivityCard label="Best month" value={activity.bestLabel} />
      </div>

      <PortfolioChart series={series} error={seriesError} />

      {/* Current portfolio */}
      <div className="mt-9 mb-4">
        <div className="font-serif text-[22px] font-semibold tracking-[-0.01em]">Current portfolio</div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          Live snapshot across all years — independent of the selected range
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <AllocationCard payload={payload} />
        <HoldingsCard payload={payload} />
      </div>

      <PnlByHoldingCard payload={payload} />

      <PnlCalendar series={series} holdings={holdingSeries} error={seriesError} />
    </div>
  );
}

function ActivityCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="font-mono text-[10.5px] tracking-[0.08em] text-[#a5a29a] uppercase">{label}</div>
      <div className="mt-[5px] font-mono text-[17px] tabular-nums">{value}</div>
    </div>
  );
}

function AllocationCard({ payload }: { payload: Payload }) {
  const total = payload.allocation.reduce((a, x) => a + x.value, 0) || 1;
  const rows = payload.allocation
    .slice()
    .sort((a, b) => b.value - a.value)
    .map((a) => ({ ...a, pct: (a.value / total) * 100, color: typeColor(a.type) }));

  return (
    <div className="rounded-xl border border-border bg-card px-6 py-[22px]">
      <div className="font-serif text-[17px] font-semibold">Allocation</div>
      <div className="mt-0.5 mb-5 text-[12px] text-muted-foreground">Current value by asset type</div>
      <div className="animate-grow-x mb-[22px] flex h-3.5 overflow-hidden rounded-[5px]">
        {rows.map((r) => (
          <div key={r.type} style={{ width: `${r.pct}%`, background: r.color }} />
        ))}
      </div>
      <div className="flex flex-col">
        {rows.map((r, i) => (
          <div key={r.type} className={cn("flex items-center justify-between py-[9px]", i < rows.length - 1 && "border-b border-[#edeae3]")}>
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
    <div className="rounded-xl border border-border bg-card px-6 py-[22px]">
      <div className="font-serif text-[17px] font-semibold">Holdings</div>
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
      <div className="mt-4 rounded-xl border border-border bg-card px-6 py-[22px]">
        <div className="font-serif text-[17px] font-semibold">Profit &amp; loss by holding</div>
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
    <div className="mt-4 rounded-xl border border-border bg-card px-6 py-[22px]">
      <div className="font-serif text-[17px] font-semibold">Profit &amp; loss by holding</div>
      <div className="mt-0.5 mb-5 text-[12px] text-muted-foreground">Total gain / loss per position, net of any proceeds</div>
      <div className="flex flex-col gap-2.5">
        {rows.map((p, i) => {
          const neg = p.pnl < 0;
          const w = neg ? (Math.abs(p.pnl) / (maxNeg || 1)) * zeroPct : (p.pnl / (maxPos || 1)) * (100 - zeroPct);
          const left = neg ? zeroPct - w : zeroPct;
          const color = neg ? "#b34a3a" : "#2f7d55";
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
