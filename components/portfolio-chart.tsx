"use client";

import * as React from "react";
import { areaY, defineChart, differenceY, lineY } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import type { BrushRange } from "@tanstack/charts/interaction/brush";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { scaleUtc } from "d3-scale";
import type { PnlPoint } from "@/lib/types";
import { fmtMil, fmtVND } from "@/lib/format";
import { bucketOf, type Bucket } from "@/components/pnl-chart";
import { DateRange, defaultWindow } from "@/components/date-range";
import { PanelHead } from "@/components/panel-head";
import { BRUSH_MIN_POINTS, SeriesBrush, useDateWindow } from "@/components/chart-brush";
import { bareAxis, CHART_HOST_STYLE, CHART_MOTION, CHART_THEME } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

const TIMEFRAMES: Bucket[] = ["Daily", "Weekly", "Monthly", "Yearly"];
type Metric = "value" | "pl";

interface Point {
  v: number;
  /** Cost basis at that point — the second line on the Value view. Undefined on P&L, where
   *  money-in has no meaning against an axis of gains. */
  cost?: number;
  date: string;
  /** The same day as a `Date`, because the x axis is a real time scale rather than a row of
   *  equally-spaced categories. A month with no closes is then a gap of the right width
   *  instead of one step like any other. */
  at: Date;
  label: string;
}

/**
 * "Updated 14:32:05", with a dot that pings once each time it changes.
 *
 * This is what a price tick looks like on this panel, and it exists because the curve
 * itself can't be it. A tick moves today's point up or down and the geometry tweens —
 * visible, but only on the ticks where the price actually moved, which on a quiet
 * afternoon is none of them. Carrying the last point forward in time doesn't help either:
 * the x scale is fitted to the data, so the newest point is pinned to the plot's right
 * edge by construction and a later timestamp just rescales the rest by a hair. Minutes
 * between ticks against a window measured in months is sub-pixel however it's drawn.
 *
 * So the honest signal is the one that says what actually happened: prices were read, at
 * this second. The ping replays on every tick because the element is keyed on the stamp —
 * a new key is a new element, and a one-shot animation starts again from the top.
 */
function LiveStamp({ asOf }: { asOf: number | null }) {
  if (asOf == null) return null;
  const t = new Date(asOf);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return (
    <span
      // Right-aligned in the title row rather than beside the controls: it reports on the
      // data, not on what you can do to it.
      className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-faint tabular-nums"
      title="When the prices behind this curve were last read"
    >
      <span key={asOf} className="size-[5px] animate-tick-ping rounded-full bg-accent-brand" />
      Updated {p2(t.getHours())}:{p2(t.getMinutes())}:{p2(t.getSeconds())}
    </span>
  );
}

/** Round up to a "nice" axis maximum (1, 2, 2.5, 5, 10 × 10ⁿ). */
function niceMax(v: number): number {
  if (v <= 0) return 1e6;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * p;
}

function fmtLabel(date: string, tf: Bucket): string {
  if (tf === "Yearly") return date.slice(0, 4);
  return tf === "Monthly" ? date.slice(0, 7) : date;
}

export function PortfolioChart({
  series,
  asOf,
  error,
}: {
  series: PnlPoint[] | null;
  /** When this series landed, in epoch ms — see `LiveStamp`. Supplied by the caller because
   *  a clock read during render is impure, and because the caller is the thing that knows:
   *  it stamps the moment each fetch resolves. */
  asOf: number | null;
  error: string | null;
}) {
  const [metric, setMetric] = React.useState<Metric>("value");
  const [timeframe, setTimeframe] = React.useState<Bucket>("Weekly");
  // `null` means "whatever the default is", not a stored pair: the series is fetched after
  // mount, so there is no span to seed a default from at first render — and this way a
  // rebuild that extends the history is reflected in an untouched window straight away.
  const [range, setRange] = React.useState<{ from: string; to: string } | null>(null);

  const minDate = series?.length ? series[0].date : "";
  const maxDate = series?.length ? series[series.length - 1].date : "";
  // The last year, matching the preset of that name so its pill reads as active on arrival.
  // Clamped to the first point: on a series younger than a year the window is the whole of
  // it, and "All" is then the honest label for what you're looking at.
  const fallback = defaultWindow(minDate, maxDate);
  const from = range?.from ?? fallback.from;
  const to = range?.to ?? fallback.to;

  // Last point of each bucket, projected onto the chosen metric. Bucketed over the whole
  // history and sliced afterwards, so switching the window doesn't re-bucket the series and
  // move every point under the reader.
  const allPts = React.useMemo<Point[]>(() => {
    if (!series) return [];
    const out: PnlPoint[] = [];
    for (const p of series) {
      const key = bucketOf(p.date, timeframe);
      if (out.length && bucketOf(out[out.length - 1].date, timeframe) === key)
        out[out.length - 1] = p;
      else out.push(p);
    }
    return out.map((p) => ({
      v: metric === "value" ? p.value : p.pnl,
      cost: metric === "value" ? p.invested : undefined,
      date: p.date,
      at: new Date(`${p.date}T00:00:00Z`),
      label: fmtLabel(p.date, timeframe),
    }));
  }, [series, metric, timeframe]);

  // The picked window: what the strip draws, and the outer bound of everything below it.
  const pts = React.useMemo(
    () => allPts.filter((p) => p.date >= from && p.date <= to),
    [allPts, from, to],
  );

  // A zoom *inside* that window, owned by the brush alone. The date picker sets how much
  // history is on the table and the strip always spans exactly that; dragging the handles
  // then reads a stretch of it without moving the pills — which is what makes the strip a
  // round trip rather than a one-way narrowing.
  const zoom = useDateWindow(pts);

  const title = metric === "value" ? "Portfolio value over time" : "P&L over time";
  const sub =
    metric === "value"
      ? "Estimated from cached daily prices, anchored to current holdings"
      : "Estimated unrealized P&L, anchored to current holdings";

  const mk = (active: boolean) =>
    cn(
      "cursor-pointer rounded-full border-0 px-3 py-[5px] text-[12px] font-semibold transition-colors",
      active ? "bg-pane-2 text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)]" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="card-surface panel-body">
      {/* Two fixed rows — title (plus the key, when there is one) over the controls —
          rather than one wrapping row. Wrapping made the layout a function of the legend:
          "Value" carries a key wide enough to push the controls onto a second line, "P&L"
          doesn't, so switching metric reflowed the header and jumped the chart up or down
          under the pointer that had just clicked. */}
      <div className="flex flex-col gap-3.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
          <PanelHead title={title} info={sub} />
          {/* Two lines need naming; one doesn't. The dashed swatch matches the stroke so
              the key is readable at a glance rather than by elimination. */}
          {metric === "value" && (
            <div className="flex items-center gap-3.5">
              <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <span className="h-[2px] w-3.5 rounded-full bg-chart-ink" />
                Value
              </span>
              <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <span
                  className="h-[2px] w-3.5"
                  style={{ backgroundImage: "repeating-linear-gradient(to right, var(--chart-gold) 0 5px, transparent 5px 9px)" }}
                />
                Invested
              </span>
            </div>
          )}
          <LiveStamp asOf={asOf} />
        </div>
        <div className="flex flex-wrap items-center gap-3.5">
          <div className="flex gap-[3px] rounded-full border border-border bg-secondary p-[3px]">
            {(["value", "pl"] as Metric[]).map((m) => (
              <button key={m} type="button" className={mk(metric === m)} onClick={() => setMetric(m)}>
                {m === "value" ? "Value" : "P&L"}
              </button>
            ))}
          </div>
          <div className="flex gap-[3px] rounded-full border border-border bg-secondary p-[3px]">
            {TIMEFRAMES.map((t) => (
              <button key={t} type="button" className={mk(timeframe === t)} onClick={() => setTimeframe(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {/* Its own row rather than a fourth group on the one above: those two pick *what*
            is plotted and how finely, this picks the window, and at anything under a wide
            desktop all five controls on one line wrap at an arbitrary point. */}
        {series && series.length > 1 && (
          <div className="flex flex-wrap items-center gap-3">
          <DateRange
            from={from}
            to={to}
            min={minDate}
            max={maxDate}
            onChange={(f, t) => {
              // A new window is a new strip, so the old selection has no meaning on it —
              // and leaving it would open the preset already zoomed into part of itself.
              setRange({ from: f, to: t });
              zoom.setRange(null);
            }}
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
        {error ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Couldn&apos;t load history: {error}
          </p>
        ) : !series ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : series.length && !pts.length ? (
          // Distinguish "you have no history" from "your window missed it" — the empty
          // state below tells you to add transactions, which is unhelpful advice when the
          // fix is to widen the dates.
          <p className="py-10 text-center text-sm text-muted-foreground">
            No history between {from} and {to}.
          </p>
        ) : (
          <ChartSvg
            pts={zoom.rows}
            strip={pts}
            metric={metric}
            handles={zoom.range}
            onHandles={zoom.setRange}
          />
        )}
      </div>
    </div>
  );
}


/**
 * The plot.
 *
 * Both metrics are the same picture — one line measured against another — so both are one
 * `differenceY`: it draws the two boundaries, fills the gap between them, and tints each
 * lobe by which line is on top, solving the exact crossing where they swap. On Value the
 * comparison line is what you put in; on P&L it is the constant zero. That replaces the
 * pair of hand-built clip paths this chart used to intersect to get the same effect, and it
 * gets the crossing right at the pixel rather than at the nearest sample.
 */
function ChartSvg({
  pts,
  strip,
  metric,
  handles,
  onHandles,
}: {
  /** The brushed window, which is what the chart draws. */
  pts: Point[];
  /** The picked window — the strip's whole span, so an untouched brush fills it. */
  strip: Point[];
  metric: Metric;
  handles: BrushRange<string> | null;
  onHandles: (next: BrushRange<string> | null) => void;
}) {

  // The cost line only exists where every point carries one — a partial series would
  // otherwise draw a line that silently jumps across the gaps.
  const hasCost = metric === "value" && pts.every((p) => p.cost != null);

  const ink = "var(--chart-ink)"; // the portfolio-value line is neutral (value isn't a gain)
  // Amber for cost basis, not the design's coral. The design pairs green Value against a
  // coral Invested, but coral is this app's loss colour everywhere else, and a red line for
  // "money you put in" reads as a warning. Amber is already the capital-deployed colour on
  // the Investments page, so the two charts agree.
  const gold = "var(--chart-gold)";
  const green = "var(--chart-positive)";
  const red = "var(--chart-negative)";

  const definition = React.useMemo(() => {
    const guide = crosshair({
      x: { stroke: "var(--foreground)", strokeOpacity: 0.4, strokeDasharray: "3 3" },
      y: false,
      marker: { radius: 4.5, stroke: "var(--card)", strokeWidth: 2 },
    });

    if (metric === "pl") {
      // Symmetric around zero, so the zero line sits in the middle of the plot and a gain
      // and a loss of the same size are the same distance from it.
      const mag = niceMax(Math.max(1, ...pts.map((p) => Math.abs(p.v))));
      return defineChart({
        marks: [
          guide,
          differenceY(pts, {
            x: "at",
            y1: 0,
            y2: "v",
            positiveFill: green,
            negativeFill: red,
            fillOpacity: 0.13,
            stroke: ink,
            strokeWidth: 2,
            comparisonStroke: "var(--grid-strong)",
            comparisonStrokeWidth: 1,
          }),
        ],
        x: { scale: scaleUtc, axis: bareAxis<Date>() },
        y: {
          scale: scaleLinear().domain([-mag, mag]),
          grid: true,
          axis: bareAxis<number>({ format: fmtMil }),
        },
        theme: CHART_THEME,
        svgAnimation: CHART_MOTION,
        focus: "nearest-x",
        maxFocusDistance: Number.POSITIVE_INFINITY,
        tooltip: { use: tooltip, content: (points) => tip(points[0]?.datum, metric) },
      });
    }

    return defineChart({
      marks: [
        guide,
        // Everything under the *lower* of the two lines: money you hold either way. The
        // tinted gap above it is then a second, stronger step of the same green rather
        // than a slab of its own.
        areaY(pts, {
          x: "at",
          y1: 0,
          y2: (p) => Math.min(p.v, p.cost ?? p.v),
          fill: green,
          fillOpacity: 0.09,
        }),
        hasCost
          ? differenceY(pts, {
              x: "at",
              y1: "cost",
              y2: "v",
              positiveFill: green,
              positiveFillOpacity: 0.2,
              negativeFill: red,
              negativeFillOpacity: 0.18,
              stroke: ink,
              strokeWidth: 2,
              comparisonStroke: gold,
              comparisonStrokeWidth: 1.5,
              comparisonStrokeDasharray: "5 4",
            })
          : lineY(pts, { x: "at", y: "v", stroke: ink, strokeWidth: 2 }),
      ],
      x: { scale: scaleUtc, axis: bareAxis<Date>() },
      y: {
        scale: scaleLinear,
        nice: true,
        grid: true,
        axis: bareAxis<number>({ format: fmtMil }),
      },
      theme: CHART_THEME,
      svgAnimation: CHART_MOTION,
      focus: "nearest-x",
      maxFocusDistance: Number.POSITIVE_INFINITY,
      tooltip: { use: tooltip, content: (points) => tip(points[0]?.datum, metric) },
    });
  }, [pts, metric, hasCost, ink, gold, green, red]);

  if (!pts.length) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No history yet — add transactions to see the curve.
      </p>
    );
  }

  return (
    <div>
      <Chart
        definition={definition}
        // A fixed height, not a ratio: this card sits in a grid whose column width changes
        // with the viewport, and a ratio would make the curve shorter exactly where there is
        // least room to read it.
        height={250}
        initialWidth={1000}
        className="w-full"
        style={CHART_HOST_STYLE}
        ariaLabel={metric === "value" ? "Portfolio value over time" : "Profit and loss over time"}
      />
      {/* The strip is the picked window end to end, so an untouched brush spans all of it —
          whatever the preset. Narrowing from there is the brush's own state, which is why
          the panel keeps a "Reset zoom" beside the picker. */}
      {handles && strip.length >= BRUSH_MIN_POINTS && (
        <div className="mt-1.5">
          <SeriesBrush
            data={strip}
            field="v"
            color={metric === "value" ? ink : green}
            range={handles}
            onRange={onHandles}
            label={
              metric === "value"
                ? "Drag to narrow the portfolio value window"
                : "Drag to narrow the profit and loss window"
            }
          />
        </div>
      )}
    </div>
  );
}

/**
 * Value, cost and the gap between them.
 *
 * The gap is the whole reason the second line is worth drawing, so the tooltip states it
 * rather than making you subtract two numbers by eye. `differenceY` gives its filled lobes
 * a datum of their own, but only the two lines carry interaction points, so a focused datum
 * is always one of ours — the guard is for the type, not for a case that happens.
 */
function tip(datum: unknown, metric: Metric) {
  const p = datum as Point | undefined;
  if (!p || typeof p.v !== "number") return { rows: [] };
  if (p.cost == null) {
    return {
      title: p.label,
      rows: [
        {
          label: metric === "value" ? "Value" : "P&L",
          value: `${p.v >= 0 && metric === "pl" ? "+" : ""}${fmtVND(p.v)}`,
          color: p.v < 0 ? "var(--chart-negative)" : metric === "value" ? "var(--chart-ink)" : "var(--chart-positive)",
        },
      ],
    };
  }
  const pnl = p.v - p.cost;
  return {
    title: p.label,
    rows: [
      { label: "Value", value: fmtVND(p.v), color: "var(--chart-ink)" },
      { label: "Invested", value: fmtVND(p.cost), color: "var(--chart-gold)" },
      {
        label: "P&L",
        value: `${pnl >= 0 ? "+" : "−"}${fmtVND(Math.abs(pnl))}`,
        color: pnl < 0 ? "var(--chart-negative)" : "var(--chart-positive)",
      },
    ],
  };
}
