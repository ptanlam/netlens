"use client";

import * as React from "react";
import type { HoldingPnlPoint, PnlDayStatus, PnlPoint } from "@/lib/types";
import { fmtVND, MONTHS } from "@/lib/format";
import { PanelHead } from "@/components/panel-head";
import { cn } from "@/lib/utils";

/** Corner indicator for a day's settlement status (month view). "live" pulses via a
 *  radar ping; "partial" breathes; "complete" is a quiet solid dot. */
function StatusDot({ status, tracked }: { status?: PnlDayStatus; tracked: boolean }) {
  if (status === "live") {
    return (
      <span title="In-progress — priced live, still moving" className="pointer-events-none absolute top-1 right-1 flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-brand opacity-70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-accent-brand" />
      </span>
    );
  }
  if (status === "partial") {
    return <span title="Partial — awaiting final NAV" className="pointer-events-none absolute top-1 right-1 size-1.5 animate-pulse rounded-full bg-warning" />;
  }
  if (status === "complete" && tracked) {
    return <span title="Complete — settled" className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-muted-foreground/40" />;
  }
  return null;
}

/** Key for the three status indicators, shown under the calendar grid. */
function StatusLegend() {
  const item = "flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-3">
      <span className={item}>
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-brand opacity-70" />
          <span className="relative inline-flex size-1.5 rounded-full bg-accent-brand" />
        </span>
        In-progress
      </span>
      <span className={item}><span className="size-1.5 animate-pulse rounded-full bg-warning" /> Partial</span>
      <span className={item}><span className="size-1.5 rounded-full bg-muted-foreground/40" /> Complete</span>
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Compact signed VND for tight calendar cells: +2.4mil / -830k. */
function fmtCompact(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}bil`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}mil`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3)}k`;
  return `${sign}${abs}`;
}

function fmtSigned(v: number): string {
  return `${v < 0 ? "−" : "+"}${fmtVND(Math.abs(v))}`;
}

/**
 * Per-holding breakdown: one diverging bar per holding, growing out from a shared centre
 * axis — losses left, gains right. The sign is then legible from the shape alone, before
 * you read a single digit, and the holding that actually moved the period is the longest
 * bar rather than just another row in a list. The period is a day in month view and a whole
 * month in year view; the rows are summed accordingly before they get here.
 *
 * Bars are scaled against the largest absolute move in the period, so each side uses its
 * full half-width; the two halves are deliberately *not* on a shared scale, since the
 * question is "what dominated the gains / the losses", not "did gains outweigh losses" (the
 * total above already answers that).
 *
 * Every holding that moved is listed — a portfolio has few enough positions that the whole
 * period fits, and a bar chart you have to page through can't be compared at a glance.
 * Mount with a `key` on the selection so the bars re-draw when you pick another.
 */
function ContribList({ rows }: { rows: { name: string; pnl: number }[] }) {
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));

  return (
    <div>
      <div className="flex flex-col gap-2.5">
        {rows.map((r, i) => {
          const neg = r.pnl < 0;
          const pct = (Math.abs(r.pnl) / maxAbs) * 100;
          return (
            <div
              key={r.name}
              className="grid grid-cols-[84px_1fr_86px] items-center gap-3 sm:grid-cols-[132px_1fr_112px] sm:gap-4"
            >
              <span className="truncate font-mono text-[11.5px] text-muted-foreground sm:text-[12.5px]" title={r.name}>
                {r.name}
              </span>
              {/* Two mirrored halves either side of a hairline axis: the loss half fills
                  from its right edge inward, the gain half from its left. */}
              <div className="flex h-3.5 items-center">
                <div className="flex flex-1 justify-end">
                  {neg && (
                    <div
                      className="animate-grow-x h-3.5 rounded-l-[3px] bg-(--chart-negative)"
                      // Inline, because `.animate-grow-x` sets transform-origin itself and
                      // a utility class wouldn't reliably win against it.
                      style={{ width: `${pct}%`, transformOrigin: "right", animationDelay: `${i * 45}ms` }}
                    />
                  )}
                </div>
                <div className="h-3.5 w-px shrink-0 bg-input" />
                <div className="flex flex-1 justify-start">
                  {!neg && (
                    <div
                      className="animate-grow-x h-3.5 rounded-r-[3px] bg-accent-brand"
                      style={{ width: `${pct}%`, animationDelay: `${i * 45}ms` }}
                    />
                  )}
                </div>
              </div>
              <span
                className={cn(
                  "text-right font-mono text-[11.5px] whitespace-nowrap tabular-nums sm:text-[12.5px]",
                  neg ? "text-(--chart-negative)" : "text-accent-brand",
                )}
              >
                {fmtSigned(r.pnl)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface DayCell {
  date: string;
  day: number;
  delta: number;
  point: PnlPoint;
  tracked: boolean;
}

/**
 * A month of the year view. `date` is a `YYYY-MM` and deliberately fills the same slot
 * `DayCell.date` does: selection, the period total and the colour ramp all work off that
 * one field, so neither has to know which view is on screen.
 */
interface MonthCell {
  date: string;
  label: string;
  delta: number;
  status?: PnlDayStatus;
  tracked: boolean;
}

const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;

export function PnlCalendar({
  series,
  holdings,
  error,
}: {
  series: PnlPoint[] | null;
  holdings: HoldingPnlPoint[] | null;
  error: string | null;
}) {
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

  const holdingsByDate = React.useMemo(() => {
    const map = new Map<string, HoldingPnlPoint["holdings"]>();
    if (holdings) for (const h of holdings) map.set(h.date, h.holdings);
    return map;
  }, [holdings]);

  const bounds = React.useMemo(() => {
    if (!series || !series.length) return null;
    return { min: series[0].date.slice(0, 7), max: series[series.length - 1].date.slice(0, 7) };
  }, [series]);

  const [view, setView] = React.useState<"month" | "year">("month");
  const [month, setMonth] = React.useState<string | null>(null);
  const active = month ?? bounds?.max ?? null;
  const [year, mon] = active
    ? [Number(active.slice(0, 4)), Number(active.slice(5, 7))]
    : [0, 0];

  // A full ISO date, not a day-of-month: the year view has to be able to name a day
  // outside the active month.
  const [selected, setSelected] = React.useState<string | null>(null);

  /** The month grid is one month, always. It used to open the previous month beside it at
   *  xl, but the calendar now lives in the dashboard's analysis column rather than across
   *  the full page — two grids there are each too narrow to read a day in. The Year view is
   *  the one that exists for comparing months. */
  const monthKeys = React.useMemo(() => (active ? [active] : []), [active]);

  /** Cells for one `YYYY-MM`, padded so the first row starts on a Monday. */
  const buildMonth = React.useCallback(
    (ym: string): (DayCell | null)[] => {
      const y = Number(ym.slice(0, 4));
      const m = Number(ym.slice(5, 7));
      const out: (DayCell | null)[] = Array(mondayIndex(new Date(y, m - 1, 1))).fill(null);
      const daysInMonth = new Date(y, m, 0).getDate();
      for (let day = 1; day <= daysInMonth; day++) {
        const date = `${ym}-${String(day).padStart(2, "0")}`;
        const hit = byDate.get(date);
        out.push({
          date,
          day,
          delta: hit?.delta ?? 0,
          point: hit?.point ?? { date, invested: 0, value: 0, pnl: 0 },
          tracked: byDate.has(date) && (hit?.delta ?? 0) !== 0,
        });
      }
      while (out.length % 7 !== 0) out.push(null);
      return out;
    },
    [byDate],
  );

  const months = React.useMemo(
    () => monthKeys.map((ym) => ({ ym, cells: buildMonth(ym) })),
    [monthKeys, buildMonth],
  );
  const cells = React.useMemo(() => months.flatMap((m) => m.cells), [months]);

  /**
   * The active year as twelve buckets, each summing its days.
   *
   * It used to be a day-per-cell contribution heatmap, 53 weeks across. A year of days is
   * too many marks to compare: at that size a cell fits no number, so the colour was the
   * only datum and reading "how did March go" meant squinting at a column. A month is the
   * unit you actually think in, and twelve cells are big enough to print the figure.
   *
   * A month counts as tracked if any day in it moved, so one that nets to zero is still
   * a month with data you can select — not an empty slot.
   */
  const monthCells = React.useMemo<MonthCell[]>(() => {
    if (!active) return [];
    const out: MonthCell[] = MONTHS.map((label, i) => ({
      date: `${year}-${String(i + 1).padStart(2, "0")}`,
      label,
      delta: 0,
      tracked: false,
    }));
    for (const [date, hit] of byDate) {
      if (Number(date.slice(0, 4)) !== year) continue;
      const b = out[Number(date.slice(5, 7)) - 1];
      if (!b || hit.delta === 0) continue;
      b.delta += hit.delta;
      b.tracked = true;
      // The month wears the least-settled status any of its days has: a month holding
      // today's in-progress figure is itself still moving. A month of settled days reads
      // "complete", so the legend under the grid describes both views.
      if (hit.point.status === "live") b.status = "live";
      else if (hit.point.status === "partial" && b.status !== "live") b.status = "partial";
      else if (hit.point.status === "complete" && !b.status) b.status = "complete";
    }
    return out;
  }, [active, year, byDate]);

  // The two views share everything downstream — only the set of cells differs, and both
  // kinds carry the `date`/`delta`/`tracked` the rest of this component reads.
  const shown: (DayCell | MonthCell | null)[] = view === "year" ? monthCells : cells;

  const maxAbs = React.useMemo(() => {
    let m = 0;
    for (const c of shown) if (c?.tracked) m = Math.max(m, Math.abs(c.delta));
    return m || 1;
  }, [shown]);

  const periodTotal = React.useMemo(
    () => shown.reduce((a, c) => (c?.tracked ? a + c.delta : a), 0),
    [shown],
  );

  // Default selection: the latest tracked cell in whatever period is on screen — the most
  // recent day in month view, the most recent month in year view.
  const latestTracked = React.useMemo(() => {
    for (let i = shown.length - 1; i >= 0; i--) if (shown[i]?.tracked) return shown[i]!.date;
    return null;
  }, [shown]);
  const selKey = (selected && shown.some((c) => c?.date === selected) ? selected : null) ?? latestTracked;
  const selCell = selKey ? shown.find((c) => c?.date === selKey) ?? null : null;
  const selHas = !!selCell?.tracked;

  /**
   * The breakdown under the grid follows the grid's unit: one day's per-holding move in
   * month view, the same holdings summed across the month in year view. A holding that
   * gained and gave it all back nets to zero and drops out — the bars are there to name
   * what moved the period, and that one didn't.
   */
  const detailRows = React.useMemo(() => {
    if (!selKey) return [];
    if (view === "year") {
      const sums = new Map<string, number>();
      for (const h of holdings ?? []) {
        if (!h.date.startsWith(selKey)) continue;
        for (const r of h.holdings) sums.set(r.name, (sums.get(r.name) ?? 0) + r.pnl);
      }
      return [...sums]
        .filter(([, pnl]) => pnl !== 0)
        .map(([name, pnl]) => ({ name, pnl }))
        .sort((a, b) => b.pnl - a.pnl);
    }
    return (holdingsByDate.get(selKey) ?? [])
      .filter((h) => h.pnl !== 0)
      .slice()
      .sort((a, b) => b.pnl - a.pnl);
  }, [selKey, view, holdings, holdingsByDate]);

  /** What a cell is, for every bit of copy under the grid. */
  const unit = view === "year" ? "month" : "day";

  /** Step the period: a month in month view, a whole year in year view. */
  function shift(delta: number) {
    if (!active) return;
    const d = view === "year"
      ? new Date(year + delta, mon - 1, 1)
      : new Date(year, mon - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    setSelected(null);
  }

  const canPrev = !!bounds && !!active && (view === "year"
    ? year > Number(bounds.min.slice(0, 4))
    : active > bounds.min);
  const canNext = !!bounds && !!active && (view === "year"
    ? year < Number(bounds.max.slice(0, 4))
    : active < bounds.max);

  /** Shared by both grids: the fill is the move, scaled against the biggest one on screen.
   *  In year view that is the biggest *month*, so a year of ordinary months uses the whole
   *  ramp instead of cowering under one outlier day. */
  function cellStyle(c: DayCell | MonthCell): React.CSSProperties {
    const border = `1px solid ${c.date === selKey ? "var(--foreground)" : "var(--divider)"}`;
    if (!c.tracked) return { background: "var(--muted)", border };
    const inten = Math.min(1, Math.abs(c.delta) / maxAbs);
    const alpha = (0.09 + 0.36 * inten).toFixed(2);
    const hue = c.delta >= 0 ? "var(--positive-rgb)" : "var(--negative-rgb)";
    return { background: `rgb(${hue} / ${alpha})`, border };
  }

  return (
    <div className="card-surface panel-body">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-5">
          <PanelHead
            title="P&amp;L calendar"
            info="Change in unrealized P&L — by day in month view, by month in year view. Select a cell for the per-holding breakdown."
          />
          {active && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => shift(-1)}
                disabled={!canPrev}
                aria-label={view === "year" ? "Previous year" : "Previous month"}
                className="size-7 rounded-md border border-input bg-pane text-[13px] text-muted-foreground disabled:opacity-40"
              >
                ‹
              </button>
              {view === "year" ? (
                <span className="rounded-md border border-input bg-pane px-2.5 py-1 text-center font-mono text-[13px] tabular-nums">
                  {year}
                </span>
              ) : (
                <input
                  type="month"
                  value={active}
                  min={bounds?.min}
                  max={bounds?.max}
                  aria-label={`${MONTH_NAMES[mon - 1]} ${year} — pick a month`}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setMonth(e.target.value);
                    setSelected(null);
                  }}
                  className="rounded-md border border-input bg-pane px-2.5 py-1 text-center font-mono text-[13px] text-foreground outline-none focus:border-ring"
                />
              )}
              <button
                type="button"
                onClick={() => shift(1)}
                disabled={!canNext}
                aria-label={view === "year" ? "Next year" : "Next month"}
                className="size-7 rounded-md border border-input bg-pane text-[13px] text-muted-foreground disabled:opacity-40"
              >
                ›
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          {active && (
            <div className="flex gap-[3px] rounded-full border border-border bg-secondary p-[3px]">
              {(["month", "year"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    "rounded-full px-3 py-[5px] text-[12px] font-semibold capitalize transition-colors",
                    view === v ? "bg-pane-2 text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)]" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
          {active && (
            // Labelled, because the figure covers whatever is on screen — and that's two
            // months once the grid goes side by side, not the one the picker names.
            <div className="text-right">
              <div className="text-[12.5px] text-muted-foreground">
                {view === "year" ? "Year P&L" : "Month P&L"}
              </div>
              <div className={cn("mt-1 font-mono text-[15px] font-semibold tabular-nums", periodTotal < 0 ? "text-(--chart-negative)" : "text-accent-brand")}>
                {fmtSigned(periodTotal)}
              </div>
            </div>
          )}
        </div>
      </div>

      {error ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load P&amp;L history: {error}</p>
      ) : !series ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !active ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No P&amp;L history yet — add transactions to see daily moves.</p>
      ) : (
        <div>
          <div className="flex flex-col">
          {view === "year" ? (
            // Twelve buckets, three across on a phone and six on anything wider — never
            // twelve in a row, which at this card's width would leave each month too narrow
            // for the figure it exists to show. The cells are taller than the month view's
            // days because each carries two lines and there are only twelve of them.
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
              {monthCells.map((c) => (
                <div
                  key={c.date}
                  onClick={c.tracked ? () => setSelected(c.date) : undefined}
                  style={cellStyle(c)}
                  title={`${c.label} ${year} · ${c.tracked ? fmtSigned(c.delta) : "no change"}${
                    c.status === "live" ? " · in-progress" : c.status === "partial" ? " · partial" : ""
                  }`}
                  className={cn(
                    "relative flex min-h-[62px] flex-col justify-between rounded-md px-2.5 py-2",
                    c.tracked && "cursor-pointer",
                  )}
                >
                  <StatusDot status={c.status} tracked={c.tracked} />
                  <div className={cn("text-[11.5px] font-semibold", c.tracked ? "text-muted-foreground" : "text-faint")}>
                    {c.label}
                  </div>
                  {/* An untracked month says so rather than sitting blank — twelve cells
                      have the room, and a year with a gap in it should look deliberate. */}
                  <div
                    className={cn(
                      "text-right font-mono text-[11.5px] tabular-nums",
                      !c.tracked ? "text-faint" : c.delta >= 0 ? "text-positive-strong" : "text-negative-strong",
                    )}
                  >
                    {c.tracked ? fmtCompact(c.delta) : "—"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-x-8 gap-y-6">
              {months.map(({ ym, cells: dayCells }) => (
                <div key={ym}>
                  {/* No month caption: the grid is one month and the picker in the header
                      already names it. */}
                  <div className="mb-1.5 grid grid-cols-7 gap-1.5">
                    {WEEKDAYS.map((w) => (
                      <div key={w} className="text-center text-[10px] font-semibold tracking-[0.14em] text-faint uppercase">{w}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {dayCells.map((c, i) =>
                      !c ? (
                        <div key={i} className="min-h-[50px]" />
                      ) : (
                        <div
                          key={i}
                          onClick={c.tracked ? () => setSelected(c.date) : undefined}
                          style={cellStyle(c)}
                          className={cn(
                            "relative flex min-h-[50px] flex-col justify-between rounded-md px-2 py-1.5",
                            c.tracked && "cursor-pointer",
                          )}
                        >
                          <StatusDot status={c.point.status} tracked={c.tracked} />
                          <div className={cn("font-mono text-[11px]", c.tracked ? "text-muted-foreground" : "text-faint")}>{c.day}</div>
                          {c.tracked && (
                            <div className={cn("hidden text-right font-mono text-[10px] tabular-nums sm:block", c.delta >= 0 ? "text-positive-strong" : "text-negative-strong")}>
                              {fmtCompact(c.delta)}
                            </div>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
            <StatusLegend />
          </div>

          <div className="mt-[22px] border-t border-border pt-[22px]">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[12.5px] text-muted-foreground">
                  Selected {unit} · per holding
                </div>
                <div className="mt-1.5 text-[18px] font-bold">
                  {selHas && selKey
                    ? view === "year"
                      ? `${MONTH_NAMES[Number(selKey.slice(5, 7)) - 1]} ${selKey.slice(0, 4)}`
                      : `${MONTHS[Number(selKey.slice(5, 7)) - 1]} ${Number(selKey.slice(8, 10))}, ${selKey.slice(0, 4)}`
                    : `No ${unit} selected`}
                </div>
              </div>
              {selHas && (
                <div className={cn("font-mono text-[21px] tracking-[-0.01em] tabular-nums", selCell!.delta < 0 ? "text-(--chart-negative)" : "text-accent-brand")}>
                  {fmtSigned(selCell!.delta)}
                </div>
              )}
            </div>
            {!selHas ? (
              <p className="py-2 text-[13px] text-faint">
                Select a {unit} with activity to see the per-holding breakdown.
              </p>
            ) : detailRows.length === 0 ? (
              <p className="py-2 text-[13px] text-faint">No per-holding breakdown for this {unit}.</p>
            ) : (
              <ContribList key={selKey} rows={detailRows} />
            )}
            {/* One expression rather than prose around `{unit}`: interpolating mid-sentence
                splits this into two JSX text nodes, and the split eats the space that opens
                the second one — "any dayin the calendar". */}
            <div className="mt-4 text-[11.5px] text-faint">
              {`Click any ${unit} in the calendar to inspect its per-holding P&L · gains right, losses left`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
