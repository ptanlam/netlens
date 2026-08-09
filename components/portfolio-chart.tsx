"use client";

import * as React from "react";
import type { PnlPoint } from "@/lib/types";
import { fmtMil, fmtVND } from "@/lib/format";
import { bucketOf, type Bucket } from "@/components/pnl-chart";
import { DateRange, defaultWindow } from "@/components/date-range";
import { PanelHead } from "@/components/panel-head";
import { ChartTip } from "@/components/chart-tip";
import { cn } from "@/lib/utils";

const TIMEFRAMES: Bucket[] = ["Daily", "Weekly", "Monthly", "Yearly"];
type Metric = "value" | "pl";

interface Point {
  v: number;
  /** Cost basis at that point — the second line on the Value view. Undefined on P&L, where
   *  money-in has no meaning against an axis of gains. */
  cost?: number;
  date: string;
  label: string;
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

/** Axis labels drop the year on narrow screens so they don't collide. */
function fmtAxisLabel(date: string, tf: Bucket, compact: boolean): string {
  const full = fmtLabel(date, tf);
  if (!compact || tf === "Yearly") return full;
  return tf === "Monthly" ? full.slice(2) : full.slice(5);
}

export function PortfolioChart({
  series,
  error,
}: {
  series: PnlPoint[] | null;
  error: string | null;
}) {
  const [metric, setMetric] = React.useState<Metric>("value");
  const [timeframe, setTimeframe] = React.useState<Bucket>("Weekly");
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
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

  // Last point of each bucket, projected onto the chosen metric.
  const pts = React.useMemo<Point[]>(() => {
    if (!series) return [];
    const out: PnlPoint[] = [];
    for (const p of series) {
      if (p.date < from || p.date > to) continue;
      const key = bucketOf(p.date, timeframe);
      if (out.length && bucketOf(out[out.length - 1].date, timeframe) === key)
        out[out.length - 1] = p;
      else out.push(p);
    }
    return out.map((p) => ({
      v: metric === "value" ? p.value : p.pnl,
      cost: metric === "value" ? p.invested : undefined,
      date: p.date,
      label: fmtLabel(p.date, timeframe),
    }));
  }, [series, metric, timeframe, from, to]);

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
        </div>
        <div className="flex flex-wrap items-center gap-3.5">
          <div className="flex gap-[3px] rounded-full border border-border bg-secondary p-[3px]">
            {(["value", "pl"] as Metric[]).map((m) => (
              <button key={m} type="button" className={mk(metric === m)} onClick={() => { setMetric(m); setHoverIdx(null); }}>
                {m === "value" ? "Value" : "P&L"}
              </button>
            ))}
          </div>
          <div className="flex gap-[3px] rounded-full border border-border bg-secondary p-[3px]">
            {TIMEFRAMES.map((t) => (
              <button key={t} type="button" className={mk(timeframe === t)} onClick={() => { setTimeframe(t); setHoverIdx(null); }}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {/* Its own row rather than a fourth group on the one above: those two pick *what*
            is plotted and how finely, this picks the window, and at anything under a wide
            desktop all five controls on one line wrap at an arbitrary point. */}
        {series && series.length > 1 && (
          <DateRange
            from={from}
            to={to}
            min={minDate}
            max={maxDate}
            onChange={(f, t) => { setRange({ from: f, to: t }); setHoverIdx(null); }}
          />
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
            pts={pts}
            metric={metric}
            timeframe={timeframe}
            hoverIdx={hoverIdx}
            setHoverIdx={setHoverIdx}
          />
        )}
      </div>
    </div>
  );
}

/** One line of the value/invested/P&L tooltip. */
function TipRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 font-mono text-[12px] tabular-nums">
      <span className="text-background/60">{label}</span>
      <span style={{ color }}>{value}</span>
    </div>
  );
}

function ChartSvg({
  pts,
  metric,
  timeframe,
  hoverIdx,
  setHoverIdx,
}: {
  pts: Point[];
  metric: Metric;
  timeframe: Bucket;
  hoverIdx: number | null;
  setHoverIdx: (i: number | null) => void;
}) {
  const n = pts.length;
  const W = 1000;
  const H = 250;

  // Rendered width of the plot area, so the x axis can thin its labels to fit.
  const axisRef = React.useRef<HTMLDivElement>(null);
  const [axisW, setAxisW] = React.useState(0);
  React.useEffect(() => {
    const el = axisRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAxisW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { yMin, yMax, ticks } = React.useMemo(() => {
    const vals = pts.map((p) => p.v);
    if (metric === "value") {
      // Both lines share one axis, so the max has to clear whichever is higher — early on
      // that's cost, since you're under water until the holdings catch up.
      const costs = pts.map((p) => p.cost ?? 0);
      const max = niceMax(Math.max(1, ...vals, ...costs));
      return { yMin: 0, yMax: max, ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => f * max) };
    }
    const mag = niceMax(Math.max(1, ...vals.map(Math.abs)));
    return { yMin: -mag, yMax: mag, ticks: [1, 0.5, 0, -0.5, -1].map((f) => f * mag) };
  }, [pts, metric]);

  if (!n) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No history yet — add transactions to see the curve.
      </p>
    );
  }

  const X = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * W);
  const Y = (v: number) => H - ((v - yMin) / (yMax - yMin)) * H;

  let line = "";
  pts.forEach((p, i) => { line += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.v).toFixed(1) + " "; });
  // The cost line only exists where every point carries one — a partial series would
  // otherwise draw a line that silently jumps across the gaps.
  const hasCost = metric === "value" && pts.every((p) => p.cost != null);
  let costLine = "";
  if (hasCost) {
    pts.forEach((p, i) => {
      costLine += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.cost as number).toFixed(1) + " ";
    });
  }

  const zeroY = Y(0);
  const baseY = metric === "value" ? H : zeroY;
  const area = line + "L" + X(n - 1).toFixed(1) + " " + baseY.toFixed(1) + " L 0 " + baseY.toFixed(1) + " Z";

  // The band between the two lines: out along value, back along cost. Where they cross it
  // pinches to a point and the two lobes wind opposite ways — both still fill, and each is
  // then tinted by which line was on top, so a crossing changes colour exactly at the cross.
  let band = "";
  let costArea = "";
  if (hasCost) {
    band = line;
    for (let i = n - 1; i >= 0; i--) band += "L" + X(i).toFixed(1) + " " + Y(pts[i].cost as number).toFixed(1) + " ";
    band += "Z";
    costArea = costLine + "L" + X(n - 1).toFixed(1) + " " + H + " L 0 " + H + " Z";
  }

  const ink = "var(--chart-ink)";   // the portfolio-value line is neutral (value isn't a gain)
  // Amber for cost basis, not the design's coral. The design pairs green Value against a
  // coral Invested, but coral is this app's loss colour everywhere else, and a red line for
  // "money you put in" reads as a warning. Amber is already the capital-deployed colour on
  // the Investments page, so the two charts agree.
  const gold = "var(--chart-gold)";
  const green = "var(--chart-positive)";
  const red = "var(--chart-negative)";

  // Thin the x axis to however many labels actually fit the rendered width.
  const GLYPH = 6; // IBM Plex Mono advance at 10px
  const GAP = 14;
  const plotW = axisW || W;
  const compact = axisW > 0 && axisW < 420;
  const axisLabel = (i: number) => fmtAxisLabel(pts[i].date, timeframe, compact);
  const labelW = (i: number) => axisLabel(i).length * GLYPH;
  const fits = Math.max(2, Math.min(9, Math.floor(plotW / (labelW(0) + GAP))));
  const step = Math.max(1, Math.ceil((n - 1) / (fits - 1)));

  // Walk back from the newest point so the latest date is always labelled. The two edge
  // labels are pinned inside the plot rather than centred, so they reach half a label
  // further inwards and can still crowd a neighbour — drop any label that collides.
  const xIdx: number[] = [];
  let keptLeft = Infinity;
  for (let i = n - 1; i >= 0; i -= step) {
    const w = labelW(i);
    const left = labelLeft(X(i) / W, plotW, w, i, n);
    if (left + w + GAP > keptLeft) continue;
    xIdx.push(i);
    keptLeft = left;
  }
  xIdx.reverse();

  const xLabels = xIdx.map((i) => (
    <div
      key={i}
      className="absolute font-mono text-[10px] whitespace-nowrap text-faint"
      style={{
        left: `${(X(i) / W) * 100}%`,
        // Keep the edge labels inside the plot instead of centring them past it.
        transform: i === 0 ? "none" : i === n - 1 ? "translateX(-100%)" : "translateX(-50%)",
      }}
    >
      {axisLabel(i)}
    </div>
  ));

  const hi = hoverIdx != null && pts[hi_ok(hoverIdx, n)] ? hoverIdx : null;
  const tipLeft = hi != null ? Math.max(6, Math.min(94, (X(hi) / W) * 100)) : 0;
  // Whichever of the two plotted markers sits highest decides which half of the plot the
  // hover card is parked in — see <ChartTip>.
  const tipTopFrac =
    hi != null
      ? Math.min(Y(pts[hi].v), hasCost ? Y(pts[hi].cost as number) : Y(pts[hi].v)) / H
      : 1;

  return (
    <div className="relative">
      <div className="relative ml-[46px] h-[250px]">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 block h-full w-full">
          {ticks.map((t, i) => (
            <line key={"g" + i} x1={0} x2={W} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? "var(--grid-strong)" : "var(--grid)"} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          {metric === "value" ? (
            <>
              {hasCost ? (
                <>
                  <defs>
                    {/* Everything below each line. Their intersection is everything below the
                        *lower* of the two, which is where the neutral wash stops and the
                        tinted band takes over. */}
                    <clipPath id="underValue"><path d={area} /></clipPath>
                    <clipPath id="underCost"><path d={costArea} /></clipPath>
                  </defs>
                  {/* Nested clips = intersection: the wash fills only up to the lower line, so
                      the band above it is a single tint rather than two stacked. Green at a
                      low alpha — everything under the value line is money you hold, and the
                      gap above gets the same green a step stronger, so the fill reads as one
                      quantity in two parts rather than a grey slab with a green hat. */}
                  <g clipPath="url(#underCost)">
                    <path className="animate-fade-in" d={area} fill="rgb(var(--positive-rgb) / 0.09)" />
                  </g>
                  {/* The gap, coloured by sign. Clipping the band to "below value" keeps only
                      the stretches where value is the upper line — the gain — and clipping it
                      to "below cost" keeps the mirror case, where you're still under water.
                      The loss band sits *above* the value line, so it never lands on the green
                      wash and stays a clean red. */}
                  <path className="animate-fade-in" d={band} fill="rgb(var(--positive-rgb) / 0.2)" clipPath="url(#underValue)" />
                  <path className="animate-fade-in" d={band} fill="rgb(var(--negative-rgb) / 0.18)" clipPath="url(#underCost)" />
                </>
              ) : (
                <path className="animate-fade-in" d={area} fill="rgb(var(--ink-rgb) / 0.11)" />
              )}
              {/* Cost first, so the value line crosses over it rather than under. */}
              {hasCost && (
                <path className="animate-draw-line" pathLength={1} d={costLine} fill="none" stroke={gold} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeDasharray="5 4" />
              )}
              <path className="animate-draw-line" pathLength={1} d={line} fill="none" stroke={ink} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </>
          ) : (
            <>
              <defs>
                <clipPath id="clipPos"><rect x={0} y={0} width={W} height={Math.max(0, zeroY)} /></clipPath>
                <clipPath id="clipNeg"><rect x={0} y={zeroY} width={W} height={Math.max(0, H - zeroY)} /></clipPath>
              </defs>
              <path className="animate-fade-in" d={area} fill="rgb(var(--positive-rgb) / 0.13)" clipPath="url(#clipPos)" />
              <path className="animate-fade-in" d={area} fill="rgb(var(--negative-rgb) / 0.13)" clipPath="url(#clipNeg)" />
              <path className="animate-draw-line" pathLength={1} d={line} fill="none" stroke="var(--chart-ink)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </>
          )}
          {hi != null && (
            <line x1={X(hi)} x2={X(hi)} y1={0} y2={H} stroke="var(--foreground)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity={0.4} />
          )}
          <rect
            x={0}
            y={0}
            width={W}
            height={H}
            fill="transparent"
            style={{ cursor: "crosshair" }}
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              let idx = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
              idx = Math.max(0, Math.min(n - 1, idx));
              if (idx !== hoverIdx) setHoverIdx(idx);
            }}
            onMouseLeave={() => setHoverIdx(null)}
          />
        </svg>
        {hi != null && (
          <div
            className="pointer-events-none absolute z-10 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
            style={{ left: `${(X(hi) / W) * 100}%`, top: `${(Y(pts[hi].v) / H) * 100}%`, borderColor: pts[hi].v < 0 ? red : metric === "value" ? ink : green, background: "var(--card)" }}
          />
        )}
        {hi != null && hasCost && (
          <div
            className="pointer-events-none absolute z-10 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
            style={{ left: `${(X(hi) / W) * 100}%`, top: `${(Y(pts[hi].cost as number) / H) * 100}%`, borderColor: gold, background: "var(--card)" }}
          />
        )}
        {hi != null && (
          <ChartTip leftPct={tipLeft} topFrac={tipTopFrac}>
            <div className="mb-0.5 font-mono text-[10px] text-background/60">{pts[hi].label}</div>
            {hasCost ? (
              // Value, cost and the gap between them. The gap is the whole reason the second
              // line is worth drawing, so the tooltip states it rather than making you
              // subtract two numbers by eye.
              <div className="flex flex-col gap-0.5">
                <TipRow label="Value" value={fmtVND(pts[hi].v)} color="var(--tooltip-neutral)" />
                <TipRow label="Invested" value={fmtVND(pts[hi].cost as number)} color="var(--tooltip-gold)" />
                <TipRow
                  label="P&L"
                  value={`${pts[hi].v - (pts[hi].cost as number) >= 0 ? "+" : "−"}${fmtVND(Math.abs(pts[hi].v - (pts[hi].cost as number)))}`}
                  color={pts[hi].v - (pts[hi].cost as number) < 0 ? "var(--tooltip-negative)" : "var(--tooltip-positive)"}
                />
              </div>
            ) : (
              <div className="font-mono text-[12.5px] tabular-nums" style={{ color: pts[hi].v < 0 ? "var(--tooltip-negative)" : metric === "value" ? "var(--tooltip-neutral)" : "var(--tooltip-positive)" }}>
                {pts[hi].v >= 0 && metric === "pl" ? "+" : ""}
                {fmtVND(pts[hi].v)}
              </div>
            )}
          </ChartTip>
        )}
      </div>
      <div className="absolute top-0 left-0 h-[250px] w-[46px]">
        {ticks.map((t, i) => (
          <div key={"y" + i} className="absolute left-0 -translate-y-1/2 font-mono text-[10.5px] text-faint" style={{ top: `${(Y(t) / H) * 100}%` }}>
            {fmtMil(t)}
          </div>
        ))}
      </div>
      <div ref={axisRef} className="relative mt-2 ml-[46px] h-[18px]">
        {xLabels}
      </div>
    </div>
  );
}

function hi_ok(i: number, n: number) {
  return Math.max(0, Math.min(n - 1, i));
}

/** Left edge of an x-axis label in px — mirrors the transform applied when rendering it. */
function labelLeft(frac: number, plotW: number, w: number, i: number, n: number): number {
  const x = frac * plotW;
  if (i === 0) return x;
  if (i === n - 1) return x - w;
  return x - w / 2;
}
