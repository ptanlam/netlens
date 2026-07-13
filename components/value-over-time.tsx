"use client";

import * as React from "react";
import { fmtTr, fmtVND } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface SeriesPoint {
  date: string;
  v: number;
}

/**
 * Sample a daily total from `start_date`-bearing items. Each item only contributes
 * once its own start date has passed, so the curve steps up as deposits/debts begin.
 * Capped at ~800 points, spanning the earliest start through today.
 */
export function buildDailySeries<T extends { start_date: string }>(
  items: T[],
  valueAt: (item: T, at: Date) => number,
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
    for (const it of items) {
      if (ms >= Date.parse(it.start_date + "T00:00:00Z")) v += valueAt(it, at);
    }
    pts.push({ date: at.toISOString().slice(0, 10), v });
  };
  for (let ms = startMs; ms <= todayMs; ms += stepDays * DAY) push(ms);
  const todayIso = new Date(todayMs).toISOString().slice(0, 10);
  if (!pts.length || pts[pts.length - 1].date !== todayIso) push(todayMs);
  return pts;
}

/** Round up to a "nice" axis maximum (1, 2, 2.5, 5, 10 × 10ⁿ). */
function niceMax(v: number): number {
  if (v <= 0) return 1e6;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * p;
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
  tipLabel,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  series: SeriesPoint[];
  stroke: string;
  areaFill: string;
  tipLabel: string;
  emptyMessage: string;
}) {
  const minDate = series.length ? series[0].date : "";
  const maxDate = series.length ? series[series.length - 1].date : "";

  const [from, setFrom] = React.useState(minDate);
  const [to, setTo] = React.useState(maxDate);
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);

  const presets = React.useMemo(
    () => [
      { label: "1M", from: shiftMonths(maxDate || minDate, -1) },
      { label: "3M", from: shiftMonths(maxDate || minDate, -3) },
      { label: "YTD", from: `${(maxDate || minDate).slice(0, 4)}-01-01` },
      { label: "All", from: minDate },
    ],
    [minDate, maxDate],
  );

  const selectCls =
    "rounded-lg border border-input bg-card px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-ring";
  const pill = (active: boolean) =>
    cn(
      "cursor-pointer rounded-md border-0 px-[11px] py-[5px] font-mono text-[11.5px] transition-colors",
      active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="rounded-xl border border-border bg-card px-6 py-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-serif text-[19px] font-semibold tracking-[-0.01em]">{title}</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">{subtitle}</div>
        </div>
        {series.length > 1 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-[3px] rounded-lg bg-background p-[3px]">
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
            pts={series.filter((p) => p.date >= from && p.date <= to)}
            stroke={stroke}
            areaFill={areaFill}
            tipLabel={tipLabel}
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
  tipLabel,
  hoverIdx,
  setHoverIdx,
}: {
  pts: SeriesPoint[];
  stroke: string;
  areaFill: string;
  tipLabel: string;
  hoverIdx: number | null;
  setHoverIdx: (i: number | null) => void;
}) {
  const n = pts.length;
  const W = 1000;
  const H = 220;

  const { yMax, ticks } = React.useMemo(() => {
    const max = niceMax(Math.max(1, ...pts.map((p) => p.v)));
    return { yMax: max, ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => f * max) };
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

  let line = "";
  pts.forEach((p, i) => { line += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.v).toFixed(1) + " "; });
  const area = line + "L" + W + " " + H + " L 0 " + H + " Z";

  const step = Math.max(1, Math.ceil(n / 9));
  const xLabels: React.ReactNode[] = [];
  for (let i = 0; i < n; i += step) {
    xLabels.push(
      <div key={i} className="absolute -translate-x-1/2 font-mono text-[10px] whitespace-nowrap text-faint" style={{ left: `${(X(i) / W) * 100}%` }}>
        {pts[i].date}
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
          <path className="animate-draw-line" pathLength={1} d={line} fill="none" stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {hi != null && (
            <>
              <line x1={X(hi)} x2={X(hi)} y1={0} y2={H} stroke="var(--foreground)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity={0.4} />
              <circle cx={X(hi)} cy={Y(pts[hi].v)} r={4} fill="var(--card)" stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </>
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
          <div className="pointer-events-none absolute top-1.5 z-10 -translate-x-1/2 rounded-md bg-foreground px-2.5 py-1.5 whitespace-nowrap" style={{ left: `${tipLeft}%` }}>
            <div className="mb-0.5 font-mono text-[10px] text-background/60">{pts[hi].date}</div>
            <div className="font-mono text-[12.5px] tabular-nums text-background">
              {tipLabel} {fmtVND(pts[hi].v)}
            </div>
          </div>
        )}
      </div>
      <div className="absolute top-0 left-0 h-[220px] w-[46px]">
        {ticks.map((t, i) => (
          <div key={"y" + i} className="absolute left-0 -translate-y-1/2 font-mono text-[10.5px] text-faint" style={{ top: `${(Y(t) / H) * 100}%` }}>
            {fmtTr(t)}
          </div>
        ))}
      </div>
      <div className="relative mt-2 ml-[46px] h-[18px]">{xLabels}</div>
    </div>
  );
}
