"use client";

import * as React from "react";
import type { PnlPoint } from "@/lib/types";
import { fmtTr, fmtVND } from "@/lib/format";
import { bucketOf, type Bucket } from "@/components/pnl-chart";
import { cn } from "@/lib/utils";

const TIMEFRAMES: Bucket[] = ["Daily", "Weekly", "Monthly", "Yearly"];
type Metric = "value" | "pl";

interface Point {
  v: number;
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
  const [timeframe, setTimeframe] = React.useState<Bucket>("Daily");
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);

  // Last point of each bucket, projected onto the chosen metric.
  const pts = React.useMemo<Point[]>(() => {
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
      date: p.date,
      label: fmtLabel(p.date, timeframe),
    }));
  }, [series, metric, timeframe]);

  const title = metric === "value" ? "Portfolio value over time" : "P&L over time";
  const sub =
    metric === "value"
      ? "Estimated from cached daily prices, anchored to current holdings"
      : "Estimated unrealized P&L, anchored to current holdings";

  const mk = (active: boolean) =>
    cn(
      "cursor-pointer rounded-md border-0 px-3 py-[5px] font-mono text-[11.5px] transition-colors",
      active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="mt-[30px] rounded-xl border border-border bg-card px-6 py-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-serif text-[20px] font-semibold tracking-[-0.01em]">{title}</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">{sub}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3.5">
          <div className="flex gap-[3px] rounded-lg bg-background p-[3px]">
            {(["value", "pl"] as Metric[]).map((m) => (
              <button key={m} type="button" className={mk(metric === m)} onClick={() => { setMetric(m); setHoverIdx(null); }}>
                {m === "value" ? "Value" : "P&L"}
              </button>
            ))}
          </div>
          <div className="flex gap-[3px] rounded-lg bg-background p-[3px]">
            {TIMEFRAMES.map((t) => (
              <button key={t} type="button" className={mk(timeframe === t)} onClick={() => { setTimeframe(t); setHoverIdx(null); }}>
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5">
        {error ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Couldn&apos;t load history: {error}
          </p>
        ) : !series ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
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
      const max = niceMax(Math.max(1, ...vals));
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
  const zeroY = Y(0);
  const baseY = metric === "value" ? H : zeroY;
  const area = line + "L" + X(n - 1).toFixed(1) + " " + baseY.toFixed(1) + " L 0 " + baseY.toFixed(1) + " Z";

  const ink = "var(--chart-ink)";   // the portfolio-value line is neutral (value isn't a gain)
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

  return (
    <div className="relative">
      <div className="relative ml-[46px] h-[250px]">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 block h-full w-full">
          {ticks.map((t, i) => (
            <line key={"g" + i} x1={0} x2={W} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? "var(--grid-strong)" : "var(--grid)"} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          {metric === "value" ? (
            <>
              <path className="animate-fade-in" d={area} fill="rgb(var(--ink-rgb) / 0.11)" />
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
        {hi != null && (
          <div className="pointer-events-none absolute top-1.5 z-10 -translate-x-1/2 rounded-md bg-foreground px-2.5 py-1.5 whitespace-nowrap" style={{ left: `${tipLeft}%` }}>
            <div className="mb-0.5 font-mono text-[10px] text-background/60">{pts[hi].label}</div>
            <div className="font-mono text-[12.5px] tabular-nums" style={{ color: pts[hi].v < 0 ? "var(--tooltip-negative)" : metric === "value" ? "var(--tooltip-neutral)" : "var(--tooltip-positive)" }}>
              {pts[hi].v >= 0 && metric === "pl" ? "+" : ""}
              {fmtVND(pts[hi].v)}
            </div>
          </div>
        )}
      </div>
      <div className="absolute top-0 left-0 h-[250px] w-[46px]">
        {ticks.map((t, i) => (
          <div key={"y" + i} className="absolute left-0 -translate-y-1/2 font-mono text-[10.5px] text-faint" style={{ top: `${(Y(t) / H) * 100}%` }}>
            {fmtTr(t)}
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
