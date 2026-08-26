"use client";

import * as React from "react";
import Link from "next/link";
import { Download, TriangleAlert } from "lucide-react";
import type { Goal, LivePayload, Payload } from "@/lib/types";
import { fmtSigned, fmtVND, MONTHS } from "@/lib/format";
import { NetWorthPanel } from "@/components/net-worth";
import { GoalStrip } from "@/components/goal-strip";
import { SummaryCards, type Stat } from "@/components/stat-card";
import { PageHeader } from "@/components/page-header";
import { QuickActions } from "@/components/quick-actions";
import { Button } from "@/components/ui/button";
import { project, type GoalView, type GoalWorld } from "@/lib/goals";
import { PortfolioChart } from "@/components/portfolio-chart";
import { PnlCalendar } from "@/components/pnl-calendar";
import { usePnlHistory } from "@/components/use-pnl-history";

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
  /** Changes when a settled day moves, or when the day does — see `usePnlHistory`. */
  historyStamp: string;
}) {
  const { series, holdings: holdingSeries, live, asOf, error: seriesError } = usePnlHistory(historyStamp);

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
          href="/transactions"
          className="flex items-start gap-2.5 rounded-xl border border-warning-border bg-warning-bg px-5 py-4 transition-colors hover:border-warning"
        >
          <TriangleAlert className="mt-0.5 size-4 text-warning" />
          <div>
            <div className="text-[13.5px] font-semibold">
              {pending} fund purchase{pending > 1 ? "s" : ""} awaiting unit confirmation
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              Enter the confirmed units on the Transactions page so live valuation stays accurate.
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
          {/* Allocation and Holdings used to sit between these two; they're on Investments
              now, beside the holdings they describe. */}
          <PortfolioChart series={series} asOf={asOf} error={seriesError} />
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
          <GoalStrip goals={goals} />
        </div>
      </div>
    </div>
  );
}
