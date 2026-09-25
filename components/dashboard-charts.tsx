"use client";

import * as React from "react";
import Link from "next/link";
import { Download, TriangleAlert } from "lucide-react";
import { AddTxDialog } from "@/components/add-tx-dialog";
import type { InstrumentOption } from "@/components/tx-form";
import type { Goal, LivePayload, Payload } from "@/lib/types";
import { fmtSigned, fmtVND, MONTHS } from "@/lib/format";
import { NetWorthPanel } from "@/components/net-worth";
import { GoalStrip } from "@/components/goal-strip";
import { StreakCard } from "@/components/streak-card";
import type { Streak } from "@/lib/score";
import { SummaryCards, type Stat } from "@/components/stat-card";
import { PageHeader } from "@/components/page-header";
import { QuickActions } from "@/components/quick-actions";
import { Button } from "@/components/ui/button";
import { project, type GoalView, type GoalWorld } from "@/lib/goals";
import { PortfolioChart } from "@/components/portfolio-chart";
import { PnlCalendar } from "@/components/pnl-calendar";
import { usePnlHistory } from "@/components/use-pnl-history";
import { cn } from "@/lib/utils";

export function DashboardCharts({
  payload,
  savings,
  funds,
  debts,
  pending,
  goalRows,
  world,
  streak,
  historyStamp,
  instruments,
}: {
  payload: Payload;
  savings: number;
  funds: number;
  debts: number;
  pending: number;
  goalRows: Goal[];
  world: GoalWorld;
  /** Finished on the server — nothing a price tick does can move it. Null when no monthly
   *  commitment is set, which the card renders as its own empty state. */
  streak: Streak | null;
  /** Changes when a settled day moves, or when the day does — see `usePnlHistory`. */
  historyStamp: string;
  /** Live holdings, for the header's Add transaction dialog. */
  instruments: InstrumentOption[];
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

  // No "Portfolio value" tile here, unlike the Investments page: the hero already carries
  // that exact figure as its Investments part, directly above this strip.
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
      {/* The design's opening row: the title, then Export as the quiet action and Add
          transaction as the one green button on the page. */}
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<a href="/export.csv" download />}>
              <Download />
              Export CSV
            </Button>
            <AddTxDialog instruments={instruments} variant="default" />
          </>
        }
      >
        Net worth, holdings and daily P&amp;L, priced from the latest close.
      </PageHeader>

      {pending > 0 && (
        <Link
          href="/transactions"
          className="flex items-start gap-3 rounded-2xl bg-warning-bg px-5 py-4 transition-colors hover:bg-[color-mix(in_oklab,var(--warning-bg),var(--warning)_8%)]"
        >
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
          <div>
            <div className="text-body font-semibold">
              {pending} fund purchase{pending > 1 ? "s" : ""} awaiting unit confirmation
            </div>
            <div className="mt-0.5 text-body-sm text-muted-foreground">
              Enter the confirmed units on the Transactions page so live valuation stays accurate.
            </div>
          </div>
        </Link>
      )}

      {/* Net worth leads, full width and in the brand's loudest type, as in the design.
          Everything under it is detail on that one figure. */}
      <NetWorthPanel
        investments={figures.portfolioTotal}
        savings={savings}
        funds={funds}
        debts={debts}
        todayDelta={todayDelta}
        todayFrom={todayFrom}
      />

      <SummaryCards stats={kpis} />

      {/* The body is a two-column grid whose rows pair panels of similar height: the
          streak with the quick actions, the portfolio chart with the goals. The P&L calendar
          (the tall one) spans the full width at the foot. Before, the two columns ran
          independently and the rail ran out a screen and a half before the charts did,
          leaving a tall empty strip down the right.
          A container query on the grid itself, not a viewport breakpoint: the sidebar is
          expanded, collapsed or a drawer, and each leaves the content a different width.
          Source order is the phone's order (quick actions first, within thumb reach); from
          two columns up, `order` places each panel beside its partner. Every cell stretches
          its card to the row's height, so paired panels end on the same line.
          Three equal tracks with the KPI row's gutter, not a 2fr/1fr split with its own:
          the wide panels span two, so every card edge down the page lands on the same two
          vertical lines as the three figures above. Two grids whose gutters miss each other
          by a few pixels read as a mistake even when you can't say why. */}
      <div className="@container">
        <div className="grid grid-cols-1 gap-3 sm:gap-4 @4xl:grid-cols-3 [&>*]:flex [&>*]:min-w-0 [&>*]:flex-col [&>*>*]:flex-1">
          {/* Beside the streak the card is as tall as the streak is, so the four doors go
              2×2 there instead of one row floating in the middle of it. */}
          <div className="@4xl:order-2 @4xl:[&>section]:grid-cols-2 @4xl:[&>section]:gap-y-5">
            <QuickActions />
          </div>
          {/* Ahead of the portfolio chart, which is the deliberate order: the chart is what
              the market did to you and the streak is what you did yourself, and only one of
              those is a thing you can act on this month. Allocation and Holdings are on
              Investments, beside the holdings they describe. */}
          <div className="@4xl:order-1 @4xl:col-span-2">
            <StreakCard streak={streak} />
          </div>
          <div className={cn("@4xl:order-3", goals.length > 0 ? "@4xl:col-span-2" : "@4xl:col-span-3")}>
            <PortfolioChart series={series} asOf={asOf} error={seriesError} />
          </div>
          {goals.length > 0 && (
            <div className="@4xl:order-4">
              <GoalStrip goals={goals} />
            </div>
          )}
          <div className="@4xl:order-5 @4xl:col-span-3">
            <PnlCalendar series={series} holdings={holdingSeries} error={seriesError} />
          </div>
        </div>
      </div>
    </div>
  );
}
