"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, Download, Search, TriangleAlert } from "lucide-react";
import type { Goal, HoldingPnlPoint, LivePayload, Payload, PnlPoint } from "@/lib/types";
import { fmtVND, MONTHS } from "@/lib/format";
import { NetWorthPanel, sparkPaths } from "@/components/net-worth";
import { EntityAvatar } from "@/components/entity-avatar";
import { holdingLogo } from "@/lib/logos";
import { GoalStrip } from "@/components/goal-strip";
import { SummaryCards, type Stat } from "@/components/stat-card";
import { PageHeader } from "@/components/page-header";
import { PanelHead } from "@/components/panel-head";
import { QuickActions } from "@/components/quick-actions";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { project, type GoalView, type GoalWorld } from "@/lib/goals";
import { PortfolioChart } from "@/components/portfolio-chart";
import { PnlCalendar } from "@/components/pnl-calendar";
import { usePriceRefreshCount } from "@/components/live-prices";
import { cn } from "@/lib/utils";

/** What `/api/pnl-history` returns. */
type PnlHistory = { series: PnlPoint[]; holdings: HoldingPnlPoint[]; live?: LivePayload };

/** Fixed slot per asset type — colour follows the entity, never its rank. */
const TYPE_COLORS: Record<string, string> = {
  Funds: "var(--chart-1)",
  Stocks: "var(--chart-2)",
  Crypto: "var(--chart-3)",
  "Real Estate": "var(--chart-4)",
};
const typeColor = (t: string) => TYPE_COLORS[t] ?? "var(--chart-5)";

/** Sentinel for the Holdings filter's "no filter" option — Base UI's Select needs a real
 *  value, and "" is indistinguishable from a cleared selection. */
const ALL_TYPES = "__all__";
/** Rows the Holdings panel shows before you ask for the rest. */
const COLLAPSED_ROWS = 4;

/** Short VND for bars/legends: ₫1.2bil, ₫372mil, ₫22mil. */
function fmtMilVND(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${v < 0 ? "−" : ""}₫${+(abs / 1e9).toFixed(1)}bil`;
  if (abs >= 1e6) return `${v < 0 ? "−" : ""}₫${Math.round(abs / 1e6)}mil`;
  return `${v < 0 ? "−" : ""}₫${Math.round(abs / 1e3)}k`;
}
function fmtSigned(v: number): string {
  return `${v < 0 ? "−" : "+"}₫${Math.abs(Math.round(v)).toLocaleString("de-DE")}`;
}

/**
 * The series, kept across remounts of this component.
 *
 * `/api/pnl-history` is the most expensive read in the app — it reconstructs every day
 * since your first transaction — and navigating away from the dashboard and back used to
 * pay for it again in full. `router.refresh()` doesn't remount, so this is exactly the
 * navigation case.
 *
 * Keyed on `historyStamp`, which the server bumps whenever a settled day moves (a
 * backfill, the recent-days sweep, any transaction edit) and which carries the current
 * date, so a tab left open overnight rebuilds. Today's own point is *not* part of the key:
 * it moves on every price tick, and a cache hit tops it up through `?today=1` — the cheap
 * query — rather than refetching hundreds of settled days to learn one new number.
 *
 * Module-level, so it lives as long as the tab and dies with a hard reload. Nothing here
 * is user-specific: this is a single-tenant app, and it is the same data the page it sits
 * on was rendered from.
 */
let historyCache: { stamp: string; series: PnlPoint[]; holdings: HoldingPnlPoint[] } | null = null;

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
  goalRows,
  world,
  historyStamp,
}: {
  payload: Payload;
  savings: number;
  funds: number;
  debts: number;
  pending: number;
  goalRows: Goal[];
  world: GoalWorld;
  /** Changes when a settled day moves, or when the day does — see `historyCache`. */
  historyStamp: string;
}) {
  // `Response.json()` resolves to `unknown` under the Workers type definitions (the DOM
  // lib types it as `any`), so the shape is asserted here rather than in each callback.
  const [series, setSeries] = React.useState<PnlPoint[] | null>(null);
  const [holdingSeries, setHoldingSeries] = React.useState<HoldingPnlPoint[] | null>(null);
  const [seriesError, setSeriesError] = React.useState<string | null>(null);
  // The price-derived figures, refreshed by each tick's `?today=1` call. Null until the
  // first tick lands, at which point the server-rendered `payload` takes over below. This
  // is what lets a tick skip `router.refresh()` on the dashboard entirely.
  const [live, setLive] = React.useState<LivePayload | null>(null);
  const refreshCount = usePriceRefreshCount();
  const loaded = series !== null;

  // Everything price-derived reads through here, so a panel can't accidentally keep
  // rendering the render-time snapshot after a tick has moved on.
  const figures: LivePayload = live ?? payload;

  // Goals track the investments total, so they'd contradict the net-worth panel above them
  // within one tick if they didn't move with it. Re-projected from the same world the
  // server built, with only `investments` swapped — the rest is price-independent.
  const goals: GoalView[] = React.useMemo(
    () =>
      goalRows.map((goal) => ({
        goal,
        proj: project(goal, live ? { ...world, investments: live.portfolioTotal } : world),
      })),
    [goalRows, world, live],
  );

  // Today's point, spliced onto whatever series is already on screen. Both the tick and a
  // cache hit want exactly this, and neither wants the days behind it refetched.
  const spliceLatest = React.useCallback((d: PnlHistory) => {
    setSeries((s) => (s ? withLatest(s, d.series) : s));
    setHoldingSeries((h) => (h ? withLatest(h, d.holdings) : h));
    if (d.live) setLive(d.live);
  }, []);

  React.useEffect(() => {
    let alive = true;
    // Read before the effect below can write, which is why that one is declared after this.
    const hit = historyCache?.stamp === historyStamp ? historyCache : null;
    // A hit still asks for today: the cached copy carries whatever price it was fetched at,
    // and only this day can have moved since. The cached days are then applied *with* that
    // answer rather than ahead of it — one render, and never a frame showing a stale price.
    // (The server renders with no cache, so this cannot run before hydration either way.)
    fetch(hit ? "/api/pnl-history?today=1" : "/api/pnl-history")
      .then((r) => (r.ok ? (r.json() as Promise<PnlHistory>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (!alive) return;
        setSeries(hit ? withLatest(hit.series, d.series) : d.series);
        setHoldingSeries(hit ? withLatest(hit.holdings, d.holdings) : d.holdings);
        if (d.live) setLive(d.live);
        setSeriesError(null); // a good re-pull clears a stale error from an earlier attempt
      })
      .catch((e: Error) => {
        if (!alive) return;
        // Only today's top-up failed — the settled days in hand are still every bit as good.
        if (hit) { setSeries(hit.series); setHoldingSeries(hit.holdings); setSeriesError(null); }
        else setSeriesError(e.message);
      });
    return () => { alive = false; };
  }, [historyStamp]);

  // Keep the cache level with what's on screen, so coming back to the dashboard restores
  // the series *including* the ticks spliced onto it since — not the state it was fetched
  // in. Declared after the effect above so a stamp change is a miss there, not a hit.
  React.useEffect(() => {
    if (series && holdingSeries) historyCache = { stamp: historyStamp, series, holdings: holdingSeries };
  }, [series, holdingSeries, historyStamp]);

  // Prices moved, so today's P&L moved with them — re-pull just that day and splice it
  // in. Waits on `loaded` so the refresh fired on app open still lands (it usually
  // completes while the first, full history fetch is still in flight).
  React.useEffect(() => {
    if (!refreshCount || !loaded) return;
    let alive = true;
    fetch("/api/pnl-history?today=1")
      .then((r) => (r.ok ? (r.json() as Promise<PnlHistory>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => alive && spliceLatest(d))
      .catch(() => {}); // a failed top-up just leaves the last good figures on screen
    return () => { alive = false; };
  }, [refreshCount, loaded, spliceLatest]);

  // Today's move + this-month total, derived from the cumulative P&L series.
  const { todayDelta, todayFrom, monthPnl, monthLabel } = React.useMemo(() => {
    if (!series || series.length === 0)
      return { todayDelta: null as number | null, todayFrom: null as string | null, monthPnl: 0, monthLabel: "" };
    const last = series[series.length - 1];
    const prev = series.length >= 2 ? series[series.length - 2] : null;
    const today = prev ? last.pnl - prev.pnl : last.pnl;
    // The move only means "today" if the prices it was subtracted from were yesterday's.
    // When a feed's last close is older, the intervening days were carried forward flat and
    // this figure covers the whole span back to `baseline` — so hand that date on and let
    // the panel say so, rather than passing off a five-day move as a one-day one.
    const from = prev && last.baseline && last.baseline < prev.date ? last.baseline : null;
    const mk = last.date.slice(0, 7);
    let prevMonthEnd = 0;
    for (const p of series) if (p.date.slice(0, 7) < mk) prevMonthEnd = p.pnl;
    const [y, m] = mk.split("-").map(Number);
    return {
      todayDelta: today, todayFrom: from,
      monthPnl: last.pnl - prevMonthEnd, monthLabel: `${MONTHS[m - 1]} ${y}`,
    };
  }, [series]);

  const pnlPct = figures.investedTotal ? (figures.pnl / figures.investedTotal) * 100 : 0;

  // No "Portfolio value" tile here, unlike the Investments page: the hero's rail already
  // carries that exact figure as its Investments row, directly above this strip.
  const kpis: Stat[] = [
    { label: "Total invested", value: fmtVND(figures.investedTotal), sub: "Cost basis, all time" },
    {
      label: "Total P&L",
      value: `${figures.pnl >= 0 ? "+" : "−"}₫${Math.abs(Math.round(figures.pnl)).toLocaleString("de-DE")}`,
      tone: figures.pnl >= 0 ? "gain" : "loss",
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
    <div className="flex flex-col gap-3 sm:gap-4">
      {/* The dashboard is the one page that had no heading of its own — the top bar named
          it instead. The design gives every view the same opening row, and CSV export is
          the only action the dashboard has. */}
      <PageHeader
        title="Dashboard"
        actions={
          <Button nativeButton={false} render={<a href="/export.csv" download />}>
            <Download className="size-3.5" />
            Export report
          </Button>
        }
      >
        Net worth, holdings and daily P&amp;L, priced from the latest close.
      </PageHeader>

      {pending > 0 && (
        <Link
          href="/investments"
          className="flex items-start gap-2.5 rounded-xl border border-warning-border bg-warning-bg px-5 py-4 transition-colors hover:border-warning"
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

      {/* The design's dashboard body: a wide analysis column and a narrow rail of small
          cards, as a wrapping flex rather than a grid, so the rail drops out beside the
          charts on its own once neither basis fits. It has to be content-driven and not a
          breakpoint: the nav is a top bar, a side rail, or a collapsed rail, and each
          leaves the content a different width, so any viewport media query would pick the
          wrong moment in two of the three.
          `flex-wrap-reverse` is what puts the rail *above* the charts once stacked rather
          than below: the two columns still lay out in source order, but the second line is
          drawn first. Net worth leads the rail and so leads the page on a phone, where
          there is no "right" to put it. The flip has one catch — reversing the wrap swaps
          cross-start for cross-end, so `items-end` is what now aligns the two columns to
          their tops. */}
      <div className="flex flex-wrap-reverse items-end gap-3 sm:gap-4">
        <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-3 sm:gap-4">
          <PortfolioChart series={series} error={seriesError} />
          <GoalStrip goals={goals} />
          <PnlCalendar series={series} holdings={holdingSeries} error={seriesError} />
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 sm:gap-4">
          <NetWorthPanel
            investments={figures.portfolioTotal}
            savings={savings}
            funds={funds}
            debts={debts}
            todayDelta={todayDelta}
            todayFrom={todayFrom}
            spark={series?.map((p) => p.value) ?? null}
          />
          <QuickActions />
          {/* One column at every width: this strip is in the rail now, and `auto-fit` would
              otherwise pack three tiles across the moment the rail wraps to full measure. */}
          <SummaryCards stats={kpis} className="grid-cols-1 lg:grid-cols-1" />
          <AllocationCard payload={figures} />
          <HoldingsListCard payload={figures} holdingSeries={holdingSeries} />
        </div>
      </div>
    </div>
  );
}

function AllocationCard({ payload }: { payload: LivePayload }) {
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
    <div className="flex h-full flex-col card-surface panel-body">
      <PanelHead title="Allocation" info="Current value by asset type, across all years." className="mb-5" />
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
            {fmtMilVND(total)}
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
              <span className="font-mono text-[12.5px] text-muted-foreground tabular-nums">{fmtMilVND(r.value)}</span>
              <span className="w-[42px] text-right font-mono text-[12.5px] tabular-nums">{r.pct.toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The design's Holdings panel: one row per position — the type-tinted mark, the name over
 * its asset type, a small value spark, and the money on the right.
 *
 * This was two panels, a bar chart of position values and a diverging bar chart of P&L.
 * They were the same ten holdings ranked two ways, and reading one against the other meant
 * matching names across half a page. A row carries both figures side by side, which is the
 * comparison you actually wanted, and it's the shape the design uses.
 */
function HoldingsListCard({
  payload,
  holdingSeries,
}: {
  payload: LivePayload;
  holdingSeries: HoldingPnlPoint[] | null;
}) {
  const [query, setQuery] = React.useState("");
  const [type, setType] = React.useState<string>(ALL_TYPES);
  const [expanded, setExpanded] = React.useState(false);

  const held = React.useMemo(
    () =>
      payload.portfolio
        .filter((p) => p.value > 0 || p.pnl !== 0)
        .slice()
        .sort((a, b) => b.value - a.value),
    [payload.portfolio],
  );

  /** Only the types actually held — a filter offering "Crypto" to someone holding none is
   *  a dead end you have to try before you learn it's empty. */
  const types = React.useMemo(
    () => Array.from(new Set(held.map((h) => h.type))).sort(),
    [held],
  );

  const rows = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return held.filter(
      (h) =>
        (type === ALL_TYPES || h.type === type) &&
        (needle === "" || h.name.toLowerCase().includes(needle)),
    );
  }, [held, query, type]);

  // Four rows by default. The panel sits in the rail beside a full-height chart column, and
  // ten holdings there turn it into the tallest thing on the page — but searching or
  // filtering is an explicit ask for a specific row, so the cap lifts for those.
  const searching = query.trim() !== "" || type !== ALL_TYPES;
  const capped = !expanded && !searching;
  const visible = capped ? rows.slice(0, COLLAPSED_ROWS) : rows;
  const hiddenCount = rows.length - visible.length;

  // Per-holding value history, keyed by name, for the row sparks. Built once for all rows
  // rather than re-scanned per row — the series is one pass over every day either way.
  const sparks = React.useMemo(() => {
    const out = new Map<string, number[]>();
    if (!holdingSeries) return out;
    for (const day of holdingSeries) {
      for (const h of day.holdings) {
        const arr = out.get(h.name);
        if (arr) arr.push(h.value);
        else out.set(h.name, [h.value]);
      }
    }
    return out;
  }, [holdingSeries]);

  if (held.length === 0) {
    return (
      <div className="card-surface panel-body">
        <PanelHead title="Holdings" />
        <p className="py-8 text-center text-sm text-muted-foreground">
          No holdings with a value yet — set live quantities or holding values to see them here.
        </p>
      </div>
    );
  }

  return (
    <div className="card-surface panel-body">
      <PanelHead
        title="Holdings"
        info="Every position with a value or a realised move, largest first. The spark is that holding's own value history; the second figure is its total gain or loss against cost."
        className="mb-3"
      />

      {/* The design's control row: a search field that takes the width, and a filter beside
          it. The filter is a real <Select> over the types actually held rather than the
          design's placeholder button. */}
      <div className="mb-1 flex gap-2.5">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[11px] border border-border bg-pane px-2.5 focus-within:border-input">
          <Search className="size-3.5 shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search holdings"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
          />
        </label>
        <Select value={type} onValueChange={(v) => v != null && setType(v)}>
          <SelectTrigger
            size="sm"
            aria-label="Filter by asset type"
            className="h-9 shrink-0 rounded-[11px] border-border bg-pane text-[12px] font-semibold"
          >
            <SelectValue>{type === ALL_TYPES ? "All" : type}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>All types</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col">
        {visible.length === 0 && (
          <p className="py-6 text-center text-[12.5px] text-muted-foreground">
            No holding matches that.
          </p>
        )}
        {visible.map((h) => {
          // A percentage only means something against real money still in the position.
          const pct = h.cost > 0 ? (h.pnl / h.cost) * 100 : null;
          const neg = h.pnl < 0;
          const paths = sparkPaths(sparks.get(h.name) ?? []);
          return (
            <div key={h.name} className="flex items-center gap-3 border-t border-divider py-3 first:border-t-0">
              <EntityAvatar name={h.name} color={typeColor(h.type)} logo={holdingLogo(h.name)} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold" title={h.name}>{h.name}</div>
                <div className="truncate text-[11px] text-faint">{h.type}</div>
              </div>
              {paths && (
                <svg
                  aria-hidden
                  viewBox="0 0 1000 300"
                  preserveAspectRatio="none"
                  className={cn("h-6 w-[58px] shrink-0", neg ? "text-(--chart-negative)" : "text-accent-brand")}
                >
                  <path d={paths.line} fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
                </svg>
              )}
              <div className="shrink-0 text-right">
                <div className="font-mono text-[12.5px] tabular-nums">{fmtMilVND(h.value)}</div>
                {h.pnl !== 0 && (
                  <div className={cn("font-mono text-[10.5px] tabular-nums", neg ? "text-(--chart-negative)" : "text-accent-brand")}>
                    {neg ? "↘ " : "↗ "}
                    {pct != null ? `${Math.abs(pct).toFixed(1)}%` : fmtSigned(h.pnl)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Only when the cap is actually hiding something, or has been lifted. Searching
          already shows every match, so no control is offered there. */}
      {!searching && (hiddenCount > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 flex w-full items-center justify-center gap-1.5 border-t border-divider pt-3 text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? "Show less" : `Show all ${rows.length}`}
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      )}
    </div>
  );
}
