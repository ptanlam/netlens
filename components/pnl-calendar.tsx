"use client";

import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { HoldingPnlPoint, PnlPoint } from "@/lib/types";
import { fmtVND } from "@/lib/format";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Fixed slot per asset type — mirrors the dashboard charts. */
const TYPE_COLORS: Record<string, string> = {
  Funds: "var(--chart-1)",
  Stocks: "var(--chart-2)",
  Crypto: "var(--chart-3)",
  "Real Estate": "var(--chart-4)",
};
const typeColor = (t: string) => TYPE_COLORS[t] ?? "var(--chart-5)";

/** Compact signed VND: +2.4tr / -830k, tuned for tight calendar cells. */
function fmtCompact(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}tỷ`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}tr`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3)}k`;
  return `${sign}${abs}`;
}

interface DayCell {
  date: string;
  day: number;
  delta: number;
  point: PnlPoint;
}

/** Monday-based weekday index (Mon=0 … Sun=6). */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function PnlCalendar({
  series,
  holdings,
  error,
}: {
  series: PnlPoint[] | null;
  holdings: HoldingPnlPoint[] | null;
  error: string | null;
}) {
  // Day-over-day P&L change, keyed by ISO date. The series is cumulative P&L,
  // so each day's realized-on-paper move is pnl[t] - pnl[t-1].
  const byDate = React.useMemo(() => {
    const map = new Map<string, { delta: number; point: PnlPoint }>();
    if (!series) return map;
    let prev = 0;
    for (const p of series) {
      map.set(p.date, { delta: p.pnl - prev, point: p });
      prev = p.pnl;
    }
    return map;
  }, [series]);

  // Per-holding breakdown for each day, for the drill-down dialog.
  const holdingsByDate = React.useMemo(() => {
    const map = new Map<string, HoldingPnlPoint["holdings"]>();
    if (holdings) for (const h of holdings) map.set(h.date, h.holdings);
    return map;
  }, [holdings]);

  const bounds = React.useMemo(() => {
    if (!series || !series.length) return null;
    return { min: series[0].date.slice(0, 7), max: series[series.length - 1].date.slice(0, 7) };
  }, [series]);

  const [month, setMonth] = React.useState<string | null>(null);
  // Default to the most recent month once the series arrives.
  const active = month ?? bounds?.max ?? null;

  const [selected, setSelected] = React.useState<string | null>(null);

  const [year, mon] = React.useMemo(() => {
    if (!active) return [0, 0] as const;
    return [Number(active.slice(0, 4)), Number(active.slice(5, 7))] as const;
  }, [active]);

  function shift(delta: number) {
    if (!active) return;
    const d = new Date(year, mon - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  const canPrev = !!bounds && !!active && active > bounds.min;
  const canNext = !!bounds && !!active && active < bounds.max;

  // Build the calendar grid: leading blanks to align the 1st, then each day,
  // grouped into Monday-started weeks.
  const weeks = React.useMemo(() => {
    if (!active) return [] as (DayCell | null)[][];
    const first = new Date(year, mon - 1, 1);
    const daysInMonth = new Date(year, mon, 0).getDate();
    const cells: (DayCell | null)[] = Array(mondayIndex(first)).fill(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const hit = byDate.get(date);
      cells.push({ date, day, delta: hit?.delta ?? 0, point: hit?.point ?? { date, invested: 0, value: 0, pnl: 0 } });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const out: (DayCell | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [active, year, mon, byDate]);

  // Largest absolute move in the month → drives colour intensity scaling.
  const maxAbs = React.useMemo(() => {
    let m = 0;
    for (const week of weeks)
      for (const c of week) if (c && byDate.has(c.date)) m = Math.max(m, Math.abs(c.delta));
    return m || 1;
  }, [weeks, byDate]);

  const monthTotal = React.useMemo(() => {
    let sum = 0;
    for (const week of weeks)
      for (const c of week) if (c && byDate.has(c.date)) sum += c.delta;
    return sum;
  }, [weeks, byDate]);

  const today = React.useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  function cellStyle(delta: number, tracked: boolean): React.CSSProperties {
    if (!tracked || delta === 0) return {};
    const pct = Math.max(8, Math.min(72, Math.round((Math.abs(delta) / maxAbs) * 72)));
    const base = delta > 0 ? "var(--chart-positive)" : "var(--chart-negative)";
    return { backgroundColor: `color-mix(in oklch, ${base} ${pct}%, transparent)` };
  }

  // Selected-day drill-down: holdings sorted by contribution to the day's move.
  const detail = React.useMemo(() => {
    if (!selected) return null;
    const point = byDate.get(selected);
    const rows = (holdingsByDate.get(selected) ?? [])
      .slice()
      .sort((a, b) => b.pnl - a.pnl);
    return { delta: point?.delta ?? 0, point: point?.point, rows };
  }, [selected, byDate, holdingsByDate]);

  function cellBody(c: DayCell, tracked: boolean) {
    return (
      <>
        <span
          className={cn(
            "text-xs font-medium tabular-nums",
            tracked ? "text-foreground/80" : "text-muted-foreground",
          )}
        >
          {c.day}
        </span>
        {tracked && c.delta !== 0 && (
          <span
            className={cn(
              "hidden text-right font-mono text-[0.7rem] leading-tight font-medium tabular-nums sm:block",
              c.delta > 0 ? "text-(--chart-positive)" : "text-(--chart-negative)",
            )}
          >
            {fmtCompact(c.delta)}
          </span>
        )}
      </>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-4 text-muted-foreground" />
            P&L calendar
          </CardTitle>
          <CardDescription>
            Daily change in unrealized P&L — tap a day for the per-holding breakdown
          </CardDescription>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="flex flex-1 items-center gap-1 sm:flex-none">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Previous month"
              disabled={!canPrev}
              onClick={() => shift(-1)}
            >
              <ChevronLeft />
            </Button>
            <Input
              type="month"
              aria-label="Jump to month"
              value={active ?? ""}
              min={bounds?.min}
              max={bounds?.max}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="h-7 w-full flex-1 justify-center text-center text-sm sm:w-40 sm:flex-none"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Next month"
              disabled={!canNext}
              onClick={() => shift(1)}
            >
              <ChevronRight />
            </Button>
          </div>
          {active && (
            <span
              className={cn(
                "ml-auto font-mono text-sm font-medium tabular-nums",
                monthTotal >= 0 ? "text-(--chart-positive)" : "text-(--chart-negative)",
              )}
            >
              {monthTotal >= 0 ? "+" : ""}
              {fmtVND(monthTotal)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Couldn&apos;t load P&L history: {error}
          </p>
        ) : !series ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : !active ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No P&L history yet — add transactions to see daily moves.
          </p>
        ) : (
          <div key={active} className="space-y-1 sm:space-y-1.5">
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {WEEKDAYS.map((w) => (
                <div key={w} className="text-center text-[0.65rem] font-medium text-muted-foreground sm:text-xs">
                  {w}
                </div>
              ))}
            </div>
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1 sm:gap-1.5">
                {week.map((c, ci) => {
                  // Stagger the pop-in by grid position so the month "unfolds".
                  const delay = { animationDelay: `${Math.min((wi * 7 + ci) * 14, 320)}ms` };
                  if (!c)
                    return (
                      <div
                        key={ci}
                        style={delay}
                        className="min-h-11 animate-pop-in rounded-md sm:min-h-14"
                      />
                    );
                  const tracked = byDate.has(c.date);
                  const isToday = c.date === today;
                  const cellClass = cn(
                    "flex min-h-11 flex-col justify-between rounded-md border p-1 text-left transition-colors sm:min-h-14 sm:p-1.5",
                    tracked ? "border-transparent" : "border-dashed bg-muted/30",
                    isToday && "ring-2 ring-ring/60",
                  );
                  if (!tracked)
                    return (
                      <div key={ci} style={delay} className={cn(cellClass, "animate-pop-in")} title={`${c.date}\nNo data`}>
                        {cellBody(c, false)}
                      </div>
                    );
                  return (
                    <button
                      key={ci}
                      type="button"
                      onClick={() => setSelected(c.date)}
                      style={{ ...cellStyle(c.delta, true), ...delay }}
                      title={`${c.date}\nDay P&L: ${c.delta >= 0 ? "+" : ""}${fmtVND(c.delta)}\nTotal P&L: ${fmtVND(c.point.pnl)} · Value ${fmtVND(c.point.value)}`}
                      className={cn(
                        cellClass,
                        "animate-pop-in cursor-pointer outline-none transition-all hover:-translate-y-0.5 hover:shadow-sm hover:ring-2 hover:ring-ring/40 focus-visible:ring-2 focus-visible:ring-ring active:scale-95 motion-reduce:transform-none",
                      )}
                    >
                      {cellBody(c, true)}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={selected != null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Holding performance</DialogTitle>
            <DialogDescription>{selected ?? ""}</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
                <span className="text-sm text-muted-foreground">Day P&L</span>
                <span
                  className={cn(
                    "font-mono text-sm font-semibold tabular-nums",
                    detail.delta >= 0 ? "text-(--chart-positive)" : "text-(--chart-negative)",
                  )}
                >
                  {detail.delta >= 0 ? "+" : ""}
                  {fmtVND(detail.delta)}
                </span>
              </div>
              {detail.rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No holdings tracked on this day.
                </p>
              ) : (
                <ul className="divide-y">
                  {detail.rows.map((h) => (
                    <li key={h.name} className="flex items-center gap-3 py-2">
                      <div
                        className="h-6 w-1 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: typeColor(h.type) }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{h.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {h.type} · {fmtVND(h.value)}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "font-mono text-sm font-medium tabular-nums",
                          h.pnl > 0
                            ? "text-(--chart-positive)"
                            : h.pnl < 0
                              ? "text-(--chart-negative)"
                              : "text-muted-foreground",
                        )}
                      >
                        {h.pnl > 0 ? "+" : ""}
                        {fmtVND(h.pnl)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {detail.point && (
                <p className="text-xs text-muted-foreground">
                  Portfolio value {fmtVND(detail.point.value)} · total P&L{" "}
                  <span
                    className={
                      detail.point.pnl >= 0 ? "text-(--chart-positive)" : "text-(--chart-negative)"
                    }
                  >
                    {detail.point.pnl >= 0 ? "+" : ""}
                    {fmtVND(detail.point.pnl)}
                  </span>
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
