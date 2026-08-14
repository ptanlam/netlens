"use client";

import * as React from "react";
import { areaY, defineChart, lineY, ruleY } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import type { BrushRange } from "@tanstack/charts/interaction/brush";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { scaleUtc } from "d3-scale";
import { fmtMil, fmtVND } from "@/lib/format";
import { PanelHead } from "@/components/panel-head";
import { bareAxis, CHART_HOST_STYLE, CHART_MOTION, CHART_THEME } from "@/components/ui/chart";
import { BRUSH_MIN_POINTS, SeriesBrush, useDateWindow } from "@/components/chart-brush";
import { DateRange, defaultWindow } from "@/components/date-range";
import { cn } from "@/lib/utils";

export interface SeriesPoint {
  date: string;
  v: number;
  /** The interest-free part of `v` (principal). Present only when a split is built;
   *  the gap `v - base` is the interest sitting inside the total on that date. */
  base?: number;
  /** Interest charged over the whole life to that date — including interest already
   *  repaid, which has left `v`. Only equals `v - base` when nothing has been repaid. */
  interest?: number;
}

/**
 * Sample a daily total from `start_date`-bearing items. Each item only contributes
 * once its own start date has passed, so the curve steps up as deposits/debts begin.
 * Capped at ~800 points, spanning the earliest start through today.
 *
 * Pass `splitAt` to also sample the interest breakdown: `v` still carries the real total,
 * `base` is the interest-free part of it (the chart shades the gap), and `interest` is
 * the lifetime figure the summary tiles quote.
 */
/**
 * `nowMs` is the instant the series ends at, and it must be supplied by the server.
 *
 * Reading the clock here instead — which this used to do — makes the output a function of
 * *when* it ran, so the server's render and the browser's hydration of the same page
 * disagree: interest accrues by the second, and a figure a fraction of a second older
 * rounds to a different whole VND. React reports that as a hydration mismatch and throws
 * away the server HTML for that subtree. Same reasoning as `GoalWorld.nowMs`.
 */
export function buildDailySeries<T extends { start_date: string }>(
  items: T[],
  valueAt: (item: T, at: Date) => number,
  splitAt: ((item: T, at: Date) => { base: number; interest: number }) | undefined,
  nowMs: number,
): SeriesPoint[] {
  if (!items.length) return [];
  const DAY = 86_400_000;
  const starts = items.map((s) => Date.parse(s.start_date + "T00:00:00Z")).filter((t) => !Number.isNaN(t));
  if (!starts.length) return [];
  const startMs = Math.min(...starts);
  const todayMs = nowMs;
  if (startMs >= todayMs) return [];

  const nDays = Math.floor((todayMs - startMs) / DAY);
  const stepDays = Math.max(1, Math.ceil(nDays / 800));
  const pts: SeriesPoint[] = [];
  const push = (ms: number) => {
    const at = new Date(ms);
    let v = 0;
    let base = 0;
    let interest = 0;
    for (const it of items) {
      if (ms >= Date.parse(it.start_date + "T00:00:00Z")) {
        v += valueAt(it, at);
        if (splitAt) {
          const s = splitAt(it, at);
          base += s.base;
          interest += s.interest;
        }
      }
    }
    const date = at.toISOString().slice(0, 10);
    // Clamp: rounding in the per-item maths must never push the baseline above the
    // total, which would render the interest band inside-out.
    pts.push(splitAt ? { date, v, base: Math.min(base, v), interest: Math.max(0, interest) } : { date, v });
  };
  let last = startMs;
  for (let ms = startMs; ms <= todayMs; ms += stepDays * DAY) { push(ms); last = ms; }
  // Compare on the instant, not the date string: the steps land on the earliest start's
  // time of day, so "today" is usually hours stale — enough for the final point to sit
  // visibly below the interest the summary tiles quote for right now.
  if (!pts.length || last !== todayMs) push(todayMs);
  return pts;
}

/**
 * Axis labels sized to the axis. `fmtMil` rounds to whole millions, which collapses an
 * interest-only axis (tens of thousands) to a column of "0mil" — so drop to thousands,
 * and allow one decimal in the millions, when the maximum is small enough to need it.
 */
function axisFmt(max: number): (v: number) => string {
  if (max >= 1e7) return fmtMil;
  if (max >= 1e6) return (v) => (v === 0 ? "0" : `${+(v / 1e6).toFixed(1)}mil`);
  if (max >= 1e4) return (v) => (v === 0 ? "0" : `${+(v / 1e3).toFixed(0)}k`);
  return (v) => (v === 0 ? "0" : `${+(v / 1e3).toFixed(1)}k`);
}

/**
 * A headline "over time" line chart driven by a date-range picker. `series` is the
 * full daily (ascending) series; the picker slices it. Shared by Savings and Debts.
 */
export function ValueOverTime({
  title,
  subtitle,
  series,
  stroke,
  areaFill,
  bandFill,
  tipLabel,
  baseLabel = "Principal",
  bandLabel = "Interest",
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  series: SeriesPoint[];
  stroke: string;
  areaFill: string;
  /** Fill for the interest band. Only used when the series carries a `base`. */
  bandFill?: string;
  tipLabel: string;
  baseLabel?: string;
  bandLabel?: string;
  emptyMessage: string;
}) {
  // Only offer the interest view when there is interest to see — an all-credit debt
  // list, say, accrues none, and an empty second view is just a dead pill.
  const split = series.some((p) => p.base !== undefined && (p.v > p.base || (p.interest ?? 0) > 0));
  const minDate = series.length ? series[0].date : "";
  const maxDate = series.length ? series[series.length - 1].date : "";

  // The last year rather than the whole history: a deposit ladder or a debt run going back
  // years compresses this year — the part you can still act on — into the right-hand inch.
  const initial = defaultWindow(minDate, maxDate);
  const [from, setFrom] = React.useState(initial.from);
  const [to, setTo] = React.useState(initial.to);
  const [metric, setMetric] = React.useState<"total" | "interest">("total");

  // Interest is often a fraction of a percent of the total, so it is invisible on an axis
  // scaled to the total. This view re-plots it alone, on its own scale — and plots the
  // lifetime figure, not the band, so it agrees with the "interest" summary tile even
  // once repayments have carried some of that interest back out of the balance.
  const shown = React.useMemo(
    () => (metric === "interest" ? series.map((p) => ({ date: p.date, v: p.interest ?? 0 })) : series),
    [series, metric],
  );

  // The picked window: the strip's whole span, so an untouched brush fills it whatever the
  // preset says.
  const windowed = React.useMemo(
    () => shown.filter((p) => p.date >= from && p.date <= to),
    [shown, from, to],
  );

  // A zoom inside that window, owned by the brush alone — the picker says how much history
  // is on the table, the handles read a stretch of it without moving the pills.
  const zoom = useDateWindow(windowed);

  const pill = (active: boolean) =>
    cn(
      "cursor-pointer rounded-full border-0 px-3 py-[5px] text-[12px] font-semibold transition-colors",
      active ? "bg-pane-2 text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)]" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="card-surface panel-body">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <PanelHead title={title} info={subtitle} />
          {split && series.length > 1 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <div className="flex gap-[3px] rounded-full border border-border bg-secondary p-[3px]">
                {(["total", "interest"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={pill(metric === m)}
                    onClick={() => setMetric(m)}
                  >
                    {m === "total" ? tipLabel : bandLabel}
                  </button>
                ))}
              </div>
              {metric === "total" && (
                <div className="flex items-center gap-3.5 text-[11.5px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: areaFill, boxShadow: `inset 0 0 0 1px ${stroke}` }} />
                    {baseLabel}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: bandFill ?? areaFill }} />
                    {bandLabel}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        {series.length > 1 && (
          <div className="flex flex-wrap items-center justify-end gap-3">
            <DateRange
              from={from}
              to={to}
              min={minDate}
              max={maxDate}
              // A new window is a new strip; the old selection means nothing on it, and
              // keeping it would open the preset already zoomed into part of itself.
              onChange={(f, t) => { setFrom(f); setTo(t); zoom.setRange(null); }}
            />
            {/* Beside the picker, not under it: appearing on its own line would grow the
                header the moment a drag ends and shift the strip out from under the pointer
                that was still on it. */}
            {zoom.zoomed && (
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
                onClick={() => zoom.setRange(null)}
              >
                Reset zoom
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-5">
        {series.length < 2 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <ChartSvg
            key={metric}
            pts={zoom.rows}
            strip={windowed}
            handles={zoom.range}
            onHandles={zoom.setRange}
            stroke={stroke}
            areaFill={metric === "interest" ? (bandFill ?? areaFill) : areaFill}
            bandFill={bandFill}
            tipLabel={metric === "interest" ? bandLabel : tipLabel}
            baseLabel={baseLabel}
            bandLabel={bandLabel}
          />
        )}
      </div>
    </div>
  );
}

/** The instant a sampled day sits at — a temporal x scale needs a Date, not a string. */
interface Plotted extends SeriesPoint {
  at: Date;
}

function ChartSvg({
  pts,
  strip,
  handles,
  onHandles,
  stroke,
  areaFill,
  bandFill,
  tipLabel,
  baseLabel,
  bandLabel,
}: {
  /** The brushed window, which is what the chart draws. */
  pts: SeriesPoint[];
  /** The picked window — the strip's whole span, so an untouched brush fills it. */
  strip: SeriesPoint[];
  handles: BrushRange<string> | null;
  onHandles: (next: BrushRange<string> | null) => void;
  stroke: string;
  areaFill: string;
  bandFill?: string;
  tipLabel: string;
  baseLabel: string;
  bandLabel: string;
}) {
  const rows: Plotted[] = React.useMemo(
    () => pts.map((p) => ({ ...p, at: new Date(`${p.date}T00:00:00Z`) })),
    [pts],
  );

  // Whether this series carries a principal/interest split, and so whether the chart is two
  // curves with a band between them or a single filled line.
  const split = strip.some((p) => p.base !== undefined);
  const baseOf = (p: SeriesPoint) => p.base ?? 0;

  // `fmtMil` rounds to whole millions, which collapses an interest-only axis (tens of
  // thousands) to a column of "0mil" — so the unit follows the size of the series. It
  // follows the *visible* one: brushing into an early stretch re-scales the axis to it.
  const fmtTick = React.useMemo(
    () => axisFmt(Math.max(1, ...rows.map((p) => p.v))),
    [rows],
  );

  const definition = React.useMemo(
    () =>
      defineChart({
        marks: [
          crosshair({
            x: { stroke: "var(--foreground)", strokeWidth: 1, strokeDasharray: "3 3", strokeOpacity: 0.4 },
            y: false,
            marker: { radius: 4.5, fill: "var(--card)", stroke, strokeWidth: 2 },
          }),
          // Without a split, one wash under the value line. With one, the wash stops at the
          // principal and the band above it — between the two curves — is the interest
          // sitting inside the balance.
          areaY(rows, { x: "at", y1: 0, y2: split ? baseOf : "v", fill: areaFill, fillOpacity: 1 }),
          ...(split
            ? [
                areaY(rows, {
                  x: "at",
                  y1: baseOf,
                  y2: "v",
                  fill: bandFill ?? areaFill,
                  fillOpacity: 1,
                }),
                lineY(rows, {
                  x: "at",
                  y: baseOf,
                  stroke,
                  strokeWidth: 1.25,
                  strokeDasharray: "4 3",
                  strokeOpacity: 0.55,
                }),
              ]
            : []),
          ruleY([0], { stroke: "var(--grid-strong)", strokeWidth: 1 }),
          lineY(rows, { x: "at", y: "v", stroke, strokeWidth: 2 }),
        ],
        // A real time scale, so the ticks land on months and years the reader recognises
        // instead of on every Nth sample — which is what an index-shaped axis gives you
        // when the sampling step is 3 days.
        x: { scale: scaleUtc, axis: bareAxis<Date>() },
        y: { scale: scaleLinear, nice: true, grid: true, axis: bareAxis<number>({ format: fmtTick }) },
        theme: CHART_THEME,
        // For the figures moving, not for the window changing. Edit a deposit's rate or add
        // one and the balance is redrawn over the same days, so the curve walks to its new
        // shape; the date picker hands the chart a different number of samples, which lands
        // as a cut whatever is set here (see `CHART_MOTION`).
        svgAnimation: CHART_MOTION,
        // The date is what you point at; how near the cursor is to the curve vertically
        // says nothing, and an unbounded radius means no dead zones between samples.
        focus: "nearest-x",
        maxFocusDistance: Number.POSITIVE_INFINITY,
        tooltip: {
          use: tooltip,
          content: (points) => {
            const p = points[0]?.datum;
            if (!p) return { rows: [] };
            return {
              title: p.date,
              rows: [
                { label: tipLabel, value: fmtVND(p.v), color: stroke },
                ...(split
                  ? [
                      { label: baseLabel, value: fmtVND(baseOf(p)) },
                      { label: bandLabel, value: `+${fmtVND(p.v - baseOf(p))}`, color: bandFill ?? areaFill },
                    ]
                  : []),
              ],
            };
          },
        },
      }),
    [rows, split, stroke, areaFill, bandFill, tipLabel, baseLabel, bandLabel, fmtTick],
  );

  if (rows.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Not enough data in this range — widen the dates.
      </p>
    );
  }

  return (
    <div>
      <Chart
        definition={definition}
        height={220}
        initialWidth={1000}
        className="w-full"
        style={CHART_HOST_STYLE}
        ariaLabel={`${tipLabel} over time`}
      />
      {/* The strip is the picked window end to end, so the handles open at its two edges
          whatever the preset — narrowing from there is the brush's own state. */}
      {handles && strip.length >= BRUSH_MIN_POINTS && (
        <div className="mt-1.5">
          <SeriesBrush
            data={strip}
            field="v"
            color={stroke}
            range={handles}
            onRange={onHandles}
            label={`Drag to narrow the ${tipLabel.toLowerCase()} date range`}
          />
        </div>
      )}
    </div>
  );
}
