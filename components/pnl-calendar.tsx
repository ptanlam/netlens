"use client";

import * as React from "react";
import type { HoldingPnlPoint, PnlDayStatus, PnlPoint } from "@/lib/types";
import { fmtVND, MONTHS } from "@/lib/format";
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

/**
 * Four discrete steps instead of a continuous alpha. At year-view cell size a smooth ramp
 * is unreadable — neighbouring days differ by a couple of percent of opacity — and stepping
 * it is also what makes a legend possible: four swatches you can actually match a cell to.
 */
const LEVEL_ALPHA = [0.2, 0.42, 0.66, 0.92];
const intensityLevel = (ratio: number) =>
  ratio <= 0.25 ? 0 : ratio <= 0.5 ? 1 : ratio <= 0.75 ? 2 : 3;

/**
 * The year grid's colour key. A heatmap whose shades aren't quantified is decoration, and
 * the year view is the one place a cell carries no number of its own — so the ramp has to
 * be spelled out: loss deepening leftward, gain deepening rightward, off a neutral middle.
 */
function RampLegend() {
  const swatch = "size-[11px] rounded-[3px]";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-3.5 font-mono text-[10px] text-muted-foreground">
      <span>More loss</span>
      {[...LEVEL_ALPHA].reverse().map((a) => (
        <span key={`l${a}`} className={swatch} style={{ background: `rgb(var(--negative-rgb) / ${a})` }} />
      ))}
      <span className={swatch} style={{ background: "var(--divider)" }} title="No change" />
      {LEVEL_ALPHA.map((a) => (
        <span key={`g${a}`} className={swatch} style={{ background: `rgb(var(--positive-rgb) / ${a})` }} />
      ))}
      <span>More gain</span>
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Width at which a second month fits without the cells getting cramped. */
const TWO_UP_QUERY = "(min-width: 1180px)";

/**
 * Whether a media query currently matches. This can't be pure CSS: the second month is
 * real data — it feeds the period total, the bar scale and the default selection — so
 * rendering it and hiding it with `hidden` would silently fold an invisible month into the
 * figures above. `useSyncExternalStore` gives server=false / client=real without the
 * set-state-in-effect that the React Compiler lint forbids.
 */
function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Step a `YYYY-MM` key by whole months. */
function shiftMonthKey(ym: string, delta: number): string {
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Net move across a month's cells — the per-grid caption when two months are shown. */
function monthTotal(cells: (DayCell | null)[]): number {
  return cells.reduce((a, c) => (c?.tracked ? a + c.delta : a), 0);
}

/** Compact signed VND for tight calendar cells: +2.4tr / -830k. */
function fmtCompact(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}tỷ`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}tr`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3)}k`;
  return `${sign}${abs}`;
}

function fmtSigned(v: number): string {
  return `${v < 0 ? "−" : "+"}${fmtVND(Math.abs(v))}`;
}

/**
 * Per-holding breakdown: one diverging bar per holding, growing out from a shared centre
 * axis — losses left, gains right. The sign is then legible from the shape alone, before
 * you read a single digit, and the holding that actually moved the day is the longest bar
 * rather than just another row in a list.
 *
 * Bars are scaled against the largest absolute move on the day, so each side uses its full
 * half-width; the two halves are deliberately *not* on a shared scale, since the question
 * is "what dominated the gains / the losses", not "did gains outweigh losses" (the day
 * total above already answers that).
 *
 * Every holding that moved is listed — a portfolio has few enough positions that the whole
 * day fits, and a bar chart you have to page through can't be compared at a glance.
 * Mount with a `key` on the selected date so the bars re-draw when you pick another day.
 */
function ContribList({ rows }: { rows: HoldingPnlPoint["holdings"] }) {
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

  // From `--breakpoint-xl` up there's room for two months side by side, which is the
  // difference between reading a month and reading a trend — most of what you want from a
  // P&L calendar is "is this month worse than last".
  const twoUp = useMediaQuery(TWO_UP_QUERY) && view === "month";

  /** The month keys on screen, oldest first. The active month is always the last one. */
  const monthKeys = React.useMemo(() => {
    if (!active) return [] as string[];
    if (!twoUp) return [active];
    const prev = shiftMonthKey(active, -1);
    // Don't open on a month that predates the data — it'd be a blank half.
    return bounds && prev < bounds.min ? [active] : [prev, active];
  }, [active, twoUp, bounds]);

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

  /** Every day of the active year, Jan 1 → Dec 31, padded so week 1 starts on a Monday. */
  const yearCells = React.useMemo(() => {
    if (!active) return [] as (DayCell | null)[];
    const out: (DayCell | null)[] = Array(mondayIndex(new Date(year, 0, 1))).fill(null);
    for (let m = 1; m <= 12; m++) {
      const days = new Date(year, m, 0).getDate();
      for (let day = 1; day <= days; day++) {
        const date = `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const hit = byDate.get(date);
        out.push({
          date,
          day,
          delta: hit?.delta ?? 0,
          point: hit?.point ?? { date, invested: 0, value: 0, pnl: 0 },
          tracked: byDate.has(date) && (hit?.delta ?? 0) !== 0,
        });
      }
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [active, year, byDate]);

  // The two views share everything downstream — only the set of cells differs.
  const shown = view === "year" ? yearCells : cells;

  const maxAbs = React.useMemo(() => {
    let m = 0;
    for (const c of shown) if (c?.tracked) m = Math.max(m, Math.abs(c.delta));
    return m || 1;
  }, [shown]);

  const periodTotal = React.useMemo(
    () => shown.reduce((a, c) => (c?.tracked ? a + c.delta : a), 0),
    [shown],
  );

  /** The week column each month starts in — drives the labels above the year grid. */
  const monthStarts = React.useMemo(() => {
    if (view !== "year") return [];
    return MONTHS.map((label, i) => {
      const idx = yearCells.findIndex((c) => c && c.date.slice(5, 7) === String(i + 1).padStart(2, "0"));
      return { label, week: idx < 0 ? 0 : Math.floor(idx / 7) };
    });
  }, [view, yearCells]);

  // Default selection: the latest tracked day in whatever period is on screen.
  const latestTracked = React.useMemo(() => {
    for (let i = shown.length - 1; i >= 0; i--) if (shown[i]?.tracked) return shown[i]!.date;
    return null;
  }, [shown]);
  const selDate = (selected && shown.some((c) => c?.date === selected) ? selected : null) ?? latestTracked;
  const selHit = selDate ? byDate.get(selDate) : null;
  const selHas = !!selHit && selHit.delta !== 0;

  const detailRows = React.useMemo(() => {
    if (!selDate) return [];
    return (holdingsByDate.get(selDate) ?? [])
      .filter((h) => h.pnl !== 0)
      .slice()
      .sort((a, b) => b.pnl - a.pnl);
  }, [selDate, holdingsByDate]);

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

  function cellStyle(c: DayCell): React.CSSProperties {
    const border = `1px solid ${c.date === selDate ? "var(--foreground)" : "var(--divider)"}`;
    if (!c.tracked) return { background: "var(--muted)", border };
    const inten = Math.min(1, Math.abs(c.delta) / maxAbs);
    const alpha = (0.09 + 0.36 * inten).toFixed(2);
    const hue = c.delta >= 0 ? "var(--positive-rgb)" : "var(--negative-rgb)";
    return { background: `rgb(${hue} / ${alpha})`, border };
  }

  /**
   * Year-view colour scale, anchored to the 90th percentile of the year's absolute moves
   * rather than its maximum. Over 365 days one crash or one spike is usually several times
   * the typical day, and dividing by that outlier pins every ordinary day to the bottom of
   * the ramp — which is exactly why the year read as one flat wash. Anything at or past the
   * p90 clamps to full strength; losing the top-end gradation costs nothing, because those
   * days are already the darkest thing on screen.
   */
  const yearScale = React.useMemo(() => {
    const mags = yearCells
      .filter((c): c is DayCell => !!c?.tracked)
      .map((c) => Math.abs(c.delta))
      .sort((a, b) => a - b);
    if (!mags.length) return 1;
    return mags[Math.min(mags.length - 1, Math.floor(mags.length * 0.9))] || 1;
  }, [yearCells]);

  function yearCellStyle(c: DayCell): React.CSSProperties {
    // Untracked days recede rather than reading as empty boxes: at this size a 1px border
    // on a faint fill is most of the cell, so the whole year looked like graph paper.
    if (!c.tracked) return { background: "var(--divider)" };
    const level = intensityLevel(Math.abs(c.delta) / yearScale);
    const hue = c.delta >= 0 ? "var(--positive-rgb)" : "var(--negative-rgb)";
    return { background: `rgb(${hue} / ${LEVEL_ALPHA[level]})` };
  }

  return (
    <div className="card-surface px-5 py-6 sm:px-[30px] sm:py-[26px]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-5">
          <div>
            <div className="text-[17px] font-bold">P&amp;L calendar</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">
              Daily change in unrealized P&amp;L — select a day for the breakdown
            </div>
          </div>
          {active && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => shift(-1)}
                disabled={!canPrev}
                aria-label={view === "year" ? "Previous year" : "Previous month"}
                className="size-7 rounded-md border border-input bg-card text-[13px] text-muted-foreground disabled:opacity-40"
              >
                ‹
              </button>
              {view === "year" ? (
                <span className="rounded-md border border-input bg-card px-2.5 py-1 text-center font-mono text-[13px] tabular-nums">
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
                  className="rounded-md border border-input bg-card px-2.5 py-1 text-center font-mono text-[13px] text-foreground outline-none focus:border-ring"
                />
              )}
              <button
                type="button"
                onClick={() => shift(1)}
                disabled={!canNext}
                aria-label={view === "year" ? "Next year" : "Next month"}
                className="size-7 rounded-md border border-input bg-card text-[13px] text-muted-foreground disabled:opacity-40"
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
                    view === v ? "bg-card text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)]" : "text-muted-foreground hover:text-foreground",
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
              <div className="text-[9.5px] font-semibold tracking-[0.14em] text-faint uppercase">
                {view === "year" ? "Year P&L" : months.length > 1 ? "2 months P&L" : "Month P&L"}
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
            // A year is 53 weeks: too many for a 7-wide grid, so weeks run as columns and
            // weekdays as rows. Cells carry no text at this size — the colour is the datum
            // and the title gives the number.
            //
            // Columns are fractional rather than a fixed 14px, so the grid grows into the
            // card instead of stranding a small block against a wide empty right-hand side.
            // The cap stops a 1600px viewport from inflating the cells into chunky tiles,
            // and the floor makes it scroll on a phone rather than shrink to specks.
            <div className="overflow-x-auto">
              <div className="mx-auto min-w-[720px] max-w-[1120px]">
                {/* Offset by the weekday gutter (w-7) plus its gap (gap-2), so a month label
                    sits over the week column its month actually starts in. */}
                <div
                  className="mb-1.5 ml-9 grid gap-[3px]"
                  style={{ gridTemplateColumns: `repeat(${yearCells.length / 7}, minmax(0,1fr))` }}
                >
                  {monthStarts.map((m) => (
                    <span
                      key={m.label}
                      className="font-mono text-[9.5px] leading-none whitespace-nowrap text-faint"
                      style={{ gridColumnStart: m.week + 1, gridColumnEnd: "span 4" }}
                    >
                      {m.label}
                    </span>
                  ))}
                </div>
                {/* The weekday gutter and the grid are siblings in this row and nothing
                    else, so the gutter stretches to exactly the grid's height and its seven
                    equal rows line up with the seven rows of cells. */}
                <div className="flex gap-2">
                  <div className="grid w-7 shrink-0 grid-rows-7 gap-[3px]">
                    {WEEKDAYS.map((w, i) => (
                      <div key={w} className="flex items-center font-mono text-[9px] leading-none text-faint">
                        {i % 2 === 0 ? w : ""}
                      </div>
                    ))}
                  </div>
                  <div
                    className="grid min-w-0 flex-1 grid-flow-col grid-rows-7 gap-[3px]"
                    style={{ gridAutoColumns: "minmax(0,1fr)" }}
                  >
                    {yearCells.map((c, i) =>
                      !c ? (
                        <div key={i} className="aspect-square" />
                      ) : (
                        <div
                          key={i}
                          onClick={c.tracked ? () => setSelected(c.date) : undefined}
                          style={yearCellStyle(c)}
                          title={`${c.date} · ${c.tracked ? fmtSigned(c.delta) : "no change"}${
                            c.point.status === "live" ? " · in-progress" : c.point.status === "partial" ? " · partial" : ""
                          }`}
                          className={cn(
                            "aspect-square rounded-[3px]",
                            c.tracked && "cursor-pointer",
                            // The selected day has to win over the status rings below it.
                            c.date === selDate
                              ? "ring-2 ring-foreground"
                              : c.point.status === "live"
                                ? "animate-pulse ring-1 ring-accent-brand"
                                : c.point.status === "partial" && "ring-1 ring-warning/60",
                          )}
                        />
                      ),
                    )}
                  </div>
                </div>
                <div className="ml-9">
                  <RampLegend />
                </div>
              </div>
            </div>
          ) : (
            <div className={cn("grid gap-x-8 gap-y-6", months.length > 1 && "grid-cols-2")}>
              {months.map(({ ym, cells: monthCells }) => (
                <div key={ym}>
                  {/* Only worth naming when there are two to tell apart — with one month the
                      picker in the header already says which. */}
                  {months.length > 1 && (
                    <div className="mb-2.5 flex items-baseline justify-between">
                      <span className="text-[12.5px] font-bold">
                        {MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} {ym.slice(0, 4)}
                      </span>
                      <span className={cn("font-mono text-[11.5px] tabular-nums", monthTotal(monthCells) < 0 ? "text-(--chart-negative)" : "text-accent-brand")}>
                        {fmtCompact(monthTotal(monthCells))}
                      </span>
                    </div>
                  )}
                  <div className="mb-1.5 grid grid-cols-7 gap-1.5">
                    {WEEKDAYS.map((w) => (
                      <div key={w} className="text-center text-[10px] font-semibold tracking-[0.14em] text-faint uppercase">{w}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1.5">
                    {monthCells.map((c, i) =>
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
                <div className="text-[9.5px] font-semibold tracking-[0.16em] text-faint uppercase">
                  Selected day · per holding
                </div>
                <div className="mt-1.5 text-[18px] font-bold">
                  {selHas && selDate
                    ? `${MONTHS[Number(selDate.slice(5, 7)) - 1]} ${Number(selDate.slice(8, 10))}, ${selDate.slice(0, 4)}`
                    : "No day selected"}
                </div>
              </div>
              {selHas && (
                <div className={cn("font-mono text-[21px] tracking-[-0.01em] tabular-nums", selHit!.delta < 0 ? "text-(--chart-negative)" : "text-accent-brand")}>
                  {fmtSigned(selHit!.delta)}
                </div>
              )}
            </div>
            {!selHas ? (
              <p className="py-2 text-[13px] text-faint">
                Select a day with activity to see the per-holding breakdown.
              </p>
            ) : detailRows.length === 0 ? (
              <p className="py-2 text-[13px] text-faint">No per-holding breakdown for this day.</p>
            ) : (
              <ContribList key={selDate} rows={detailRows} />
            )}
            <div className="mt-4 text-[11.5px] text-faint">
              Click any day in the calendar to inspect that day&apos;s per-holding P&amp;L · gains
              right, losses left
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
