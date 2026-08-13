"use client";

import * as React from "react";
import { barX, cell, colorLegend, defineChart, ruleX, text } from "@tanstack/charts";
import { controlledSignal } from "@tanstack/charts/interaction/signal";
import { decorative } from "@tanstack/charts/mark/decorative";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import {
  keyedSelection, whenSelected, type KeyedSelectionChange,
} from "@tanstack/charts/selection";
import { tooltip } from "@tanstack/charts/tooltip";
import { portal } from "@tanstack/charts/tooltip/portal";
import { scaleThreshold } from "d3-scale";
import type { HoldingPnlPoint, PnlDayStatus, PnlPoint } from "@/lib/types";
import { fmtMil, fmtVND, MONTHS } from "@/lib/format";
import { PanelHead } from "@/components/panel-head";
import { bareAxis, CHART_HOST_STYLE, CHART_THEME } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The year grid's four columns, three rows of them. Twelve cells across would leave each
 *  month too narrow for the figure it exists to show. */
const YEAR_COLS = ["q1", "q2", "q3", "q4"];

/** Mark id for the figure printed under a day, so a media query can reach it. */
const FIGURE_MARK = "pnl-cell-figure";

/**
 * The gap between two squares, as a share of the step, and the inset each square takes off
 * its own band.
 *
 * The two stack — the band leaves a gutter and the mark shrinks inside what's left — so the
 * visible gap is the sum, which is why both come down together. Keep `paddingOuter` at half
 * of `CELL_PADDING` wherever this is used on the x scale: that ratio is what puts a band's
 * centre on an equal division of the plot, and so what keeps the weekday header lined up
 * with the columns it names.
 */
const CELL_PADDING = 0.045;
const CELL_INSET = 1;

/** The marks a click lands on — the tracked days, which are the only ones `selection.key`
 *  answers for. Named so the host can put a pointer cursor on exactly those and leave the
 *  blank squares reading as inert, which they are. */
const DAY_MARK: Record<PnlDayStatus | "none", string> = {
  complete: "pnl-day-complete",
  partial: "pnl-day-partial",
  live: "pnl-day-live",
  none: "pnl-day-blank",
};

/** The vertical budget per row, per view. A day carries two short lines; a month of the year
 *  carries the same two but there are only twelve of them, so they can afford the room.
 *  Slightly more than the square ends up being — `padding` on the band scale spends the
 *  difference on the gaps between squares. */
const CELL_PX = { month: 55, year: 79 } as const;

/** What the chart lays out below the grid — the colour key — and so what the host has to be
 *  taller than the rows themselves. The same in both views now that neither prints an x
 *  axis: the weekday names sit above the grid, outside the chart. */
const CHROME_PX = { month: 65, year: 65 } as const;

/**
 * The weekday header, in the app's own markup rather than the chart's.
 *
 * The library places a cartesian axis below the plot and offers no way to move it, which for
 * a calendar is the one position that doesn't work — the names label the columns you are
 * about to read, not the ones you have just read. Seven equal columns land on the same
 * centres the band scale does: the plot spans the full host width (the y axis is off), so
 * band `i` is centred at `(i + 0.5) / 7` of it, which is exactly what a centred 7-track grid
 * gives.
 */
function WeekdayHead() {
  return (
    <div className="grid grid-cols-7 pb-1.5">
      {WEEKDAYS.map((d) => (
        <div key={d} className="text-center font-mono text-[11px] text-muted-foreground">
          {d}
        </div>
      ))}
    </div>
  );
}

/** A cell's outline carries its settlement state: the two unfinished ones ring themselves in
 *  their own colour, a settled one wears the same hairline as everything else. This was a
 *  corner dot, which the SVG scene has no way to place inside a band. */
const STATUS_RING: Record<PnlDayStatus | "none", { stroke: string; strokeWidth: number }> = {
  live: { stroke: "var(--accent-brand)", strokeWidth: 1.5 },
  partial: { stroke: "var(--warning)", strokeWidth: 1.5 },
  complete: { stroke: "var(--divider)", strokeWidth: 1 },
  none: { stroke: "var(--divider)", strokeWidth: 1 },
};

/**
 * The diverging ramp, as six steps rather than a continuous alpha.
 *
 * A threshold scale is what makes the key under the grid possible: the library renders a
 * stepped legend straight off the scale's own boundaries, which a computed `rgb(… / α)` per
 * cell could never describe. Six steps is also about as many tints as the eye can tell apart
 * on a 48px square, so nothing is lost by naming them.
 *
 * Bare RGB triples, so the alpha is ours to set and the hue still flips with the theme.
 */
const RAMP = [
  "rgb(var(--negative-rgb) / 0.45)",
  "rgb(var(--negative-rgb) / 0.30)",
  "rgb(var(--negative-rgb) / 0.15)",
  "rgb(var(--positive-rgb) / 0.15)",
  "rgb(var(--positive-rgb) / 0.30)",
  "rgb(var(--positive-rgb) / 0.45)",
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

/** The ramp's boundaries, for the legend under the grid. `fmtMil` renders 0 as an em dash,
 *  which is right in a table cell and wrong on the one label that anchors the whole scale. */
function fmtBoundary(v: number): string {
  if (v === 0) return "0";
  return `${v < 0 ? "−" : "+"}${fmtMil(Math.abs(v))}`;
}

/** A holding name has to fit the axis gutter; the tooltip carries the full one. */
function shortName(name: string): string {
  return name.length > 17 ? `${name.slice(0, 16)}…` : name;
}

/** Key for the settlement rings, shown under the calendar grid. Not the chart's own
 *  legend: that one belongs to the colour scale, and a chart has exactly one of those. */
function StatusKey() {
  const item = "flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground";
  const swatch = "size-2.5 rounded-[3px] border-[1.5px]";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1">
      <span className={item}><span className={cn(swatch, "border-accent-brand")} /> In-progress</span>
      <span className={item}><span className={cn(swatch, "border-warning")} /> Partial</span>
      <span className={item}><span className={cn(swatch, "border-divider")} /> Settled</span>
    </div>
  );
}

/** Where the value column sits, in the bar chart's own units — bars reach ±1, so everything
 *  past that is gutter. */
const GUTTER = 1.72;

/**
 * Per-holding breakdown: one diverging bar per holding, growing out from a shared centre
 * axis — losses left, gains right. The sign is then legible from the shape alone, before
 * you read a single digit, and the holding that actually moved the period is the longest
 * bar rather than just another row in a list. The period is a day in month view and a whole
 * month in year view; the rows are summed accordingly before they get here.
 *
 * The bar's length is a *share of its own side's largest move*, which is why the x scale is
 * a plain [-1, 1] and the axis is hidden: the two halves are deliberately not on a common
 * scale, since the question is "what dominated the gains / the losses", not "did gains
 * outweigh losses" (the total above already answers that). The money itself is printed at
 * the end of every row, in the gutter the domain leaves past the widest bar.
 *
 * Every holding that moved is listed — a portfolio has few enough positions that the whole
 * period fits, and a bar chart you have to page through can't be compared at a glance.
 * Mount with a `key` on the selection so the bars re-draw when you pick another.
 */
function ContribChart({ rows }: { rows: { name: string; pnl: number }[] }) {
  const data = React.useMemo(() => {
    const maxUp = Math.max(1, ...rows.map((r) => Math.max(0, r.pnl)));
    const maxDown = Math.max(1, ...rows.map((r) => Math.max(0, -r.pnl)));
    return rows.map((r) => ({ ...r, share: r.pnl / (r.pnl < 0 ? maxDown : maxUp) }));
  }, [rows]);

  const definition = React.useMemo(
    () =>
      defineChart({
        marks: [
          ruleX([0], { stroke: "var(--input)", strokeWidth: 1 }),
          barX(data, {
            x1: 0,
            x2: "share",
            y: "name",
            fill: (r) => (r.pnl < 0 ? "var(--chart-negative)" : "var(--accent-brand)"),
            radius: 3,
            maxThickness: 14,
          }),
          // The figure sits in the gutter the domain leaves to the right of every bar, so
          // the money reads down one column however long the bars are.
          decorative(
            text(data, {
              x: () => GUTTER,
              y: "name",
              text: (r) => fmtSigned(r.pnl),
              anchor: "end",
              fontSize: 11.5,
              fill: (r) => (r.pnl < 0 ? "var(--chart-negative)" : "var(--accent-brand)"),
            }),
          ),
        ],
        // An instance, not a factory: the domain is the encoding here, not something to be
        // inferred from the shares that happen to be on screen.
        x: { scale: scaleLinear([-1.04, GUTTER], [0, 1]), axis: false },
        y: {
          scale: scaleBand<string>().domain(data.map((r) => r.name)).padding(0.34),
          axis: bareAxis<string>({ format: shortName }),
        },
        theme: CHART_THEME,
        focusRing: false,
        tooltip: {
          use: tooltip,
          portal,
          placement: ["top", "bottom"],
          offset: 10,
          content: (points) => {
            const r = points[0]?.datum;
            if (!r) return { rows: [] };
            return {
              title: r.name,
              rows: [
                {
                  label: "P&L",
                  value: fmtSigned(r.pnl),
                  color: r.pnl < 0 ? "var(--chart-negative)" : "var(--accent-brand)",
                },
              ],
            };
          },
        },
      }),
    [data],
  );

  return (
    <Chart
      definition={definition}
      height={Math.max(48, data.length * 26)}
      initialWidth={620}
      className="w-full"
      style={CHART_HOST_STYLE}
      ariaLabel="Per-holding profit and loss for the selected period"
    />
  );
}

/**
 * One square of the calendar, in either view.
 *
 * `date` is a `YYYY-MM-DD` in month view and a `YYYY-MM` in year view, and deliberately
 * fills the same slot in both: selection, the period total and the colour ramp all work off
 * that one field, so none of them has to know which view is on screen. `col`/`row` are the
 * two band values that place the square.
 */
interface GridCell {
  date: string;
  /** The number or month name printed in the square. */
  label: string;
  /** The period spelled out, for the tooltip's heading. */
  full: string;
  delta: number;
  tracked: boolean;
  status?: PnlDayStatus;
  col: string;
  row: string;
}

const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;

const pad2 = (n: number) => String(n).padStart(2, "0");

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

  // A full ISO date, not a day-of-month: the year view has to be able to name a period
  // outside the active month.
  const [selected, setSelected] = React.useState<string | null>(null);

  /** The month grid is one month, always. It used to open the previous month beside it at
   *  xl, but the calendar now lives in the dashboard's analysis column rather than across
   *  the full page — two grids there are each too narrow to read a day in. The Year view is
   *  the one that exists for comparing months. */
  const monthGrid = React.useMemo<GridCell[]>(() => {
    if (!active) return [];
    const lead = mondayIndex(new Date(year, mon - 1, 1));
    const days = new Date(year, mon, 0).getDate();
    return Array.from({ length: days }, (_unused, i) => {
      const date = `${active}-${pad2(i + 1)}`;
      const hit = byDate.get(date);
      const delta = hit?.delta ?? 0;
      const slot = lead + i;
      return {
        date,
        label: String(i + 1),
        full: `${WEEKDAYS[slot % 7]}, ${i + 1} ${MONTH_NAMES[mon - 1]} ${year}`,
        delta,
        tracked: byDate.has(date) && delta !== 0,
        status: hit?.point.status,
        col: WEEKDAYS[slot % 7],
        row: `w${Math.floor(slot / 7)}`,
      };
    });
  }, [active, year, mon, byDate]);

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
  const yearGrid = React.useMemo<GridCell[]>(() => {
    if (!active) return [];
    const out: GridCell[] = MONTHS.map((label, i) => ({
      date: `${year}-${pad2(i + 1)}`,
      label,
      full: `${MONTH_NAMES[i]} ${year}`,
      delta: 0,
      tracked: false,
      col: YEAR_COLS[i % 4],
      row: `r${Math.floor(i / 4)}`,
    }));
    for (const [date, hit] of byDate) {
      if (Number(date.slice(0, 4)) !== year) continue;
      const b = out[Number(date.slice(5, 7)) - 1];
      if (!b || hit.delta === 0) continue;
      b.delta += hit.delta;
      b.tracked = true;
      // The month wears the least-settled status any of its days has: a month holding
      // today's in-progress figure is itself still moving. A month of settled days reads
      // "complete", so the key under the grid describes both views.
      if (hit.point.status === "live") b.status = "live";
      else if (hit.point.status === "partial" && b.status !== "live") b.status = "partial";
      else if (hit.point.status === "complete" && !b.status) b.status = "complete";
    }
    return out;
  }, [active, year, byDate]);

  // The two views share everything downstream — only the set of squares differs, and both
  // kinds carry the `date`/`delta`/`tracked` the rest of this component reads.
  const cells = React.useMemo(
    () => (view === "year" ? yearGrid : monthGrid),
    [view, yearGrid, monthGrid],
  );

  /** The rows the grid actually needs. A month starting on a Sunday runs to six. */
  const rowKeys = React.useMemo(
    () => [...new Set(cells.map((c) => c.row))],
    [cells],
  );

  const maxAbs = React.useMemo(() => {
    let m = 0;
    for (const c of cells) if (c.tracked) m = Math.max(m, Math.abs(c.delta));
    return m || 1;
  }, [cells]);

  /** The move, scaled against the biggest one on screen. In year view that is the biggest
   *  *month*, so a year of ordinary months uses the whole ramp instead of cowering under one
   *  outlier day. A configured instance rather than a factory, because the boundaries are
   *  the encoding — an inferred domain would re-scale itself to whichever cells survived. */
  const ramp = React.useMemo(
    () =>
      scaleThreshold<number, string>()
        .domain([-maxAbs / 2, -maxAbs / 6, 0, maxAbs / 6, maxAbs / 2])
        .range(RAMP),
    [maxAbs],
  );

  const periodTotal = React.useMemo(
    () => cells.reduce((a, c) => (c.tracked ? a + c.delta : a), 0),
    [cells],
  );

  // Default selection: the latest tracked square in whatever period is on screen — the most
  // recent day in month view, the most recent month in year view.
  const latestTracked = React.useMemo(() => {
    for (let i = cells.length - 1; i >= 0; i--) if (cells[i].tracked) return cells[i].date;
    return null;
  }, [cells]);
  const selKey = (selected && cells.some((c) => c.date === selected) ? selected : null) ?? latestTracked;
  const selCell = selKey ? cells.find((c) => c.date === selKey) ?? null : null;
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

  /** One mark per settlement state, because a rect paints one stroke for the whole mark —
   *  the fill still comes from the shared ramp, so the four are one heatmap. */
  const bands = React.useMemo(
    () => ({
      blank: cells.filter((c) => !c.tracked),
      settled: cells.filter((c) => c.tracked && c.status !== "live" && c.status !== "partial"),
      partial: cells.filter((c) => c.tracked && c.status === "partial"),
      live: cells.filter((c) => c.tracked && c.status === "live"),
    }),
    [cells],
  );

  const definition = React.useMemo(() => {
    // The chart owns the click and the Enter key; this only says which square is selected
    // and takes the answer back. An untracked square has no key, so clicking it is a no-op
    // rather than a selection you then have to undo.
    const selection = keyedSelection({
      selected: controlledSignal<string | null, KeyedSelectionChange<GridCell, string>>(
        selKey,
        (next) => setSelected(next),
      ),
      key: (c: GridCell) => (c.tracked ? c.date : null),
    });

    const square = (data: GridCell[], state: PnlDayStatus | "none", fill?: string) =>
      cell(data, {
        id: DAY_MARK[state],
        x: "col",
        y: "row",
        color: "delta",
        key: "date",
        fill,
        stroke: STATUS_RING[state].stroke,
        strokeWidth: STATUS_RING[state].strokeWidth,
        radius: 5,
        inset: CELL_INSET,
        // Mark states resolve only while something is focused, which is exactly the hover
        // (and keyboard) highlight — a square lifts under the cursor without a second
        // piece of React state tracking which one it is.
        states: [
          {
            when: { focus: "primary" },
            style: { stroke: "var(--foreground)", strokeOpacity: 0.5, strokeWidth: 1.5 },
          },
        ],
      });

    const isYear = view === "year";

    return defineChart({
      marks: [
        square(bands.blank, "none", "var(--muted)"),
        square(bands.settled, "complete"),
        square(bands.partial, "partial"),
        square(bands.live, "live"),
        // Drawn over the fills rather than styled into them: a selection outlives the
        // pointer, and only a mark of its own can say so after the focus has gone.
        whenSelected(
          cell(cells, {
            x: "col",
            y: "row",
            key: "date",
            fill: "none",
            stroke: "var(--foreground)",
            strokeWidth: 2,
            radius: 5,
            inset: CELL_INSET,
          }),
          selection,
        ),
        decorative(
          text(cells, {
            x: "col",
            y: "row",
            text: "label",
            dy: isYear ? -11 : -8,
            fontSize: isYear ? 12 : 11,
            fontWeight: 600,
            fill: (c) => (c.tracked ? "var(--muted-foreground)" : "var(--faint)"),
          }),
        ),
        decorative(
          text(cells, {
            // Named, so the `sm` rule on the host can drop this one row of labels: a phone
            // gives a day ~38px and the figure needs more than that. The mark id is what
            // the renderer stamps on the group as `data-ts-key`.
            id: FIGURE_MARK,
            x: "col",
            y: "row",
            // An untracked month says so rather than sitting blank — twelve squares have
            // the room, and a year with a gap in it should look deliberate. A month of
            // days does not: 31 em dashes read as noise.
            text: (c) => (c.tracked ? fmtCompact(c.delta) : isYear ? "—" : ""),
            dy: isYear ? 12 : 9,
            fontSize: isYear ? 11.5 : 9.5,
            fill: (c) =>
              !c.tracked
                ? "var(--faint)"
                : c.delta >= 0
                  ? "var(--positive-strong)"
                  : "var(--negative-strong)",
          }),
        ),
      ],
      x: {
        // An instance, not a factory: the domain is the calendar's own shape, and only a
        // configured scale keeps a column a month never landed on.
        // Outer padding is deliberately half the inner, which is the one ratio that puts a
        // band's centre on an equal division of the plot: the step is
        // `range / (n - inner + 2·outer)`, so it comes to `range / n` exactly when
        // `2·outer = inner`, and the columns then land where a plain 7-track grid would put
        // them. That is what lets the hand-rolled weekday header above sit on the same
        // centres. `padding(0.11)` — setting both — drifts the end columns by ~4px.
        scale: scaleBand<string>()
          .domain(isYear ? YEAR_COLS : WEEKDAYS)
          .paddingInner(CELL_PADDING)
          .paddingOuter(CELL_PADDING / 2),
        // No printed axis in either view. The year grid's four columns are arbitrary slots
        // and never had one; the weekday names are a *header*, and the library's cartesian
        // axis only renders below the plot. A calendar you read weekday-first with "Mon" set
        // underneath the last row is the wrong shape, so that one row stays hand-rolled —
        // see `<WeekdayHead>`.
        axis: false,
      },
      y: {
        scale: scaleBand<string>().domain(rowKeys).padding(CELL_PADDING),
        axis: false,
      },
      color: {
        scale: ramp,
        // The library reads the ramp's own boundaries off the scale and draws the swatches
        // and their labels; all that is ours is the wording of the numbers.
        legend: colorLegend({ format: fmtBoundary, width: 260, placement: "bottom" }),
      },
      theme: CHART_THEME,
      // Zero on the sides, so the plot spans the host exactly and the hand-rolled weekday
      // header above it lands on the same seven centres the band scale does. The library
      // otherwise reserves a few pixels for an axis label to overhang into, which nothing
      // here needs now that neither axis prints.
      margin: { top: 2, left: 0, right: 0 },
      focusRing: false,
      selection,
      // No tooltip on the grid. Every square already prints its own figure, so a card
      // following the pointer repeated what was under it — and on a grid you read by
      // sweeping across, a panel that opens on every cell is in the way of the sweep. The
      // detail belongs to the block below, which a click fills in and which stays put.
      tooltip: false,
    });
  }, [bands, cells, rowKeys, ramp, selKey, view]);

  /** What a square is, for every bit of copy under the grid. */
  const unit = view === "year" ? "month" : "day";

  /** Step the period: a month in month view, a whole year in year view. */
  function shift(delta: number) {
    if (!active) return;
    const d = view === "year"
      ? new Date(year + delta, mon - 1, 1)
      : new Date(year, mon - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
    setSelected(null);
  }

  const canPrev = !!bounds && !!active && (view === "year"
    ? year > Number(bounds.min.slice(0, 4))
    : active > bounds.min);
  const canNext = !!bounds && !!active && (view === "year"
    ? year < Number(bounds.max.slice(0, 4))
    : active < bounds.max);

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
          {view !== "year" && <WeekdayHead />}
          <Chart
            definition={definition}
            height={
              rowKeys.length * (view === "year" ? CELL_PX.year : CELL_PX.month) +
              (view === "year" ? CHROME_PX.year : CHROME_PX.month)
            }
            initialWidth={620}
            className={cn(
              "w-full",
              // A tracked day answers a click, so it says so under the pointer. The blank
              // squares deliberately don't: `selection.key` returns null for them and the
              // click is a no-op, which an arrow is the honest cursor for. One class per
              // state, spelled out rather than built from `DAY_MARK`, because Tailwind only
              // sees class names it can read literally.
              "[&_[data-ts-key=pnl-day-complete]]:cursor-pointer",
              "[&_[data-ts-key=pnl-day-partial]]:cursor-pointer",
              "[&_[data-ts-key=pnl-day-live]]:cursor-pointer",
              // Twelve month squares are wide enough for their figure at any width; 31 day
              // squares are not, and on a phone the date alone is what fits — the block
              // below answers for the number once you tap a day.
              view !== "year" && "max-sm:[&_[data-ts-key=pnl-cell-figure]]:hidden",
            )}
            // The figures are the panel's point, and every figure in this app is mono.
            style={{ ...CHART_HOST_STYLE, fontFamily: "var(--font-mono), monospace" }}
            ariaLabel={
              view === "year"
                ? `Profit and loss by month for ${year}`
                : `Profit and loss by day for ${MONTH_NAMES[mon - 1]} ${year}`
            }
          />
          <StatusKey />

          <div className="mt-[22px] border-t border-border pt-[22px]">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[12.5px] text-muted-foreground">
                  Selected {unit} · per holding
                </div>
                <div className="mt-1.5 text-[18px] font-bold">
                  {selHas && selCell
                    ? view === "year"
                      ? selCell.full
                      : `${MONTHS[Number(selCell.date.slice(5, 7)) - 1]} ${Number(selCell.date.slice(8, 10))}, ${selCell.date.slice(0, 4)}`
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
              <ContribChart key={selKey} rows={detailRows} />
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
