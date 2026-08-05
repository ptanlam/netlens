"use client";

import * as React from "react";
import { fmtMil, fmtVND } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import { PanelHead } from "@/components/panel-head";
import { ChartTip } from "@/components/chart-tip";
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
export function buildDailySeries<T extends { start_date: string }>(
  items: T[],
  valueAt: (item: T, at: Date) => number,
  splitAt?: (item: T, at: Date) => { base: number; interest: number },
): SeriesPoint[] {
  if (!items.length) return [];
  const DAY = 86_400_000;
  const starts = items.map((s) => Date.parse(s.start_date + "T00:00:00Z")).filter((t) => !Number.isNaN(t));
  if (!starts.length) return [];
  const startMs = Math.min(...starts);
  const todayMs = Date.now();
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
 * Round up to a "nice" axis maximum. The steps are fine-grained on purpose: coarse ones
 * put a 105mil series on a 200mil axis, and the headroom squashes the interest band that
 * is already the thinnest thing on the chart.
 */
const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function niceMax(v: number): number {
  if (v <= 0) return 1e6;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (NICE_STEPS.find((s) => n <= s) ?? 10) * p;
}

function shiftMonths(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1 + delta, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
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

  const [from, setFrom] = React.useState(minDate);
  const [to, setTo] = React.useState(maxDate);
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
  const [metric, setMetric] = React.useState<"total" | "interest">("total");

  // Interest is often a fraction of a percent of the total, so it is invisible on an axis
  // scaled to the total. This view re-plots it alone, on its own scale — and plots the
  // lifetime figure, not the band, so it agrees with the "interest" summary tile even
  // once repayments have carried some of that interest back out of the balance.
  const shown = React.useMemo(
    () => (metric === "interest" ? series.map((p) => ({ date: p.date, v: p.interest ?? 0 })) : series),
    [series, metric],
  );

  const presets = React.useMemo(
    () => [
      { label: "1M", from: shiftMonths(maxDate || minDate, -1) },
      { label: "3M", from: shiftMonths(maxDate || minDate, -3) },
      { label: "YTD", from: `${(maxDate || minDate).slice(0, 4)}-01-01` },
      { label: "All", from: minDate },
    ],
    [minDate, maxDate],
  );

  // Fixed height, not padding: a <select> and a date field derive different intrinsic
  // heights from the same padding, and the row sits next to the range pills.
  const selectCls =
    "h-7 rounded-lg border border-input bg-pane px-2.5 font-mono text-[12px] outline-none focus:border-ring";
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
                    onClick={() => { setMetric(m); setHoverIdx(null); }}
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
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-[3px] rounded-full border border-border bg-secondary p-[3px]">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={pill(from === p.from && to === maxDate)}
                  onClick={() => { setFrom(p.from); setTo(maxDate); setHoverIdx(null); }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={from}
                min={minDate}
                max={to}
                onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setHoverIdx(null); } }}
                className={selectCls}
              />
              <span className="text-faint">–</span>
              <input
                type="date"
                value={to}
                min={from}
                max={maxDate}
                onChange={(e) => { if (e.target.value) { setTo(e.target.value); setHoverIdx(null); } }}
                className={selectCls}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-5">
        {series.length < 2 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <ChartSvg
            key={metric}
            pts={shown.filter((p) => p.date >= from && p.date <= to)}
            stroke={stroke}
            areaFill={metric === "interest" ? (bandFill ?? areaFill) : areaFill}
            bandFill={bandFill}
            tipLabel={metric === "interest" ? bandLabel : tipLabel}
            baseLabel={baseLabel}
            bandLabel={bandLabel}
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
  stroke,
  areaFill,
  bandFill,
  tipLabel,
  baseLabel,
  bandLabel,
  hoverIdx,
  setHoverIdx,
}: {
  pts: SeriesPoint[];
  stroke: string;
  areaFill: string;
  bandFill?: string;
  tipLabel: string;
  baseLabel: string;
  bandLabel: string;
  hoverIdx: number | null;
  setHoverIdx: (i: number | null) => void;
}) {
  const n = pts.length;
  const W = 1000;
  const H = 220;

  // Full ISO dates are ~62px wide; a phone plot is only ~240px, so ~9 of them collide.
  // Thin the axis to ~4 labels on mobile and drop the year to keep them legible.
  const isMobile = useMediaQuery("(max-width: 640px)");

  const { yMax, ticks, fmtTick } = React.useMemo(() => {
    const max = niceMax(Math.max(1, ...pts.map((p) => p.v)));
    return { yMax: max, ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => f * max), fmtTick: axisFmt(max) };
  }, [pts]);

  if (n < 2) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Not enough data in this range — widen the dates.
      </p>
    );
  }

  const X = (i: number) => (i / (n - 1)) * W;
  const Y = (v: number) => H - (v / yMax) * H;

  const trace = (get: (p: SeriesPoint) => number) =>
    pts.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(get(p)).toFixed(1) + " ").join("");

  const line = trace((p) => p.v);
  const split = pts.some((p) => p.base !== undefined);
  const baseOf = (p: SeriesPoint) => p.base ?? 0;
  const baseLine = split ? trace(baseOf) : "";

  // Without a split, one area under the value line. With one, the fill under the
  // baseline is principal and the band between the two curves is accrued interest.
  const area = (split ? baseLine : line) + "L" + W + " " + H + " L 0 " + H + " Z";
  const band = split
    ? line +
      pts
        .map((p, i) => "L" + X(pts.length - 1 - i).toFixed(1) + " " + Y(baseOf(pts[pts.length - 1 - i])).toFixed(1) + " ")
        .join("") +
      "Z"
    : "";

  const step = Math.max(1, Math.ceil(n / (isMobile ? 4 : 9)));
  const xLabels: React.ReactNode[] = [];
  for (let i = 0; i < n; i += step) {
    xLabels.push(
      <div key={i} className="absolute -translate-x-1/2 font-mono text-[10px] whitespace-nowrap text-faint" style={{ left: `${(X(i) / W) * 100}%` }}>
        {isMobile ? pts[i].date.slice(5) : pts[i].date}
      </div>,
    );
  }

  const hi = hoverIdx != null && pts[hoverIdx] ? hoverIdx : null;
  const tipLeft = hi != null ? Math.max(6, Math.min(94, (X(hi) / W) * 100)) : 0;

  return (
    <div className="relative">
      <div className="relative ml-[46px] h-[220px]">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 block h-full w-full">
          {ticks.map((t, i) => (
            <line key={"g" + i} x1={0} x2={W} y1={Y(t)} y2={Y(t)} stroke={t === 0 ? "var(--grid-strong)" : "var(--grid)"} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <path className="animate-fade-in" d={area} fill={areaFill} />
          {split && <path className="animate-fade-in" d={band} fill={bandFill ?? areaFill} />}
          {split && (
            <path
              className="animate-draw-line"
              pathLength={1}
              d={baseLine}
              fill="none"
              stroke={stroke}
              strokeWidth={1.25}
              strokeDasharray="4 3"
              opacity={0.55}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          )}
          <path className="animate-draw-line" pathLength={1} d={line} fill="none" stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
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
            style={{ left: `${(X(hi) / W) * 100}%`, top: `${(Y(pts[hi].v) / H) * 100}%`, borderColor: stroke, background: "var(--card)" }}
          />
        )}
        {hi != null && (
          <ChartTip leftPct={tipLeft} topFrac={Y(pts[hi].v) / H}>
            <div className="mb-0.5 font-mono text-[10px] text-background/60">{pts[hi].date}</div>
            <div className="font-mono text-[12.5px] tabular-nums text-background">
              {tipLabel} {fmtVND(pts[hi].v)}
            </div>
            {split && (
              <div className="mt-1 space-y-0.5 border-t border-background/20 pt-1 font-mono text-[10.5px] tabular-nums text-background/70">
                <div>{baseLabel} {fmtVND(baseOf(pts[hi]))}</div>
                <div>{bandLabel} +{fmtVND(pts[hi].v - baseOf(pts[hi]))}</div>
              </div>
            )}
          </ChartTip>
        )}
      </div>
      <div className="absolute top-0 left-0 h-[220px] w-[46px]">
        {ticks.map((t, i) => (
          <div key={"y" + i} className="absolute left-0 -translate-y-1/2 font-mono text-[10.5px] text-faint" style={{ top: `${(Y(t) / H) * 100}%` }}>
            {fmtTick(t)}
          </div>
        ))}
      </div>
      <div className="relative mt-2 ml-[46px] h-[18px]">{xLabels}</div>
    </div>
  );
}
