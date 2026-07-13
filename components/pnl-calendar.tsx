"use client";

import * as React from "react";
import type { HoldingPnlPoint, PnlPoint } from "@/lib/types";
import { fmtVND, MONTHS } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

const CONTRIB_PAGE_SIZE = 5;

/** Per-holding breakdown, paginated so the panel keeps a stable height at every
 *  width. Mount with a `key` on the selected date to reset to the first page. */
function ContribList({ rows }: { rows: HoldingPnlPoint["holdings"] }) {
  const [page, setPage] = React.useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / CONTRIB_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * CONTRIB_PAGE_SIZE;
  const end = Math.min(start + CONTRIB_PAGE_SIZE, rows.length);
  const paged = pageCount > 1;

  const navBtn =
    "rounded-md border border-input bg-card px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40";

  return (
    <div>
      {/* Fix the body height only when paging, so a short single page stays
          compact (no wasted space / no overflow) but multi-page rows don't jump. */}
      <div className={paged ? "h-[158px] overflow-hidden" : undefined}>
        {rows.slice(start, end).map((r) => (
          <div key={r.name} className="flex items-center justify-between border-b border-divider py-[7px]">
            <span className="font-mono text-[11px]">{r.name}</span>
            <span className={cn("font-mono text-[11px] tabular-nums", r.pnl < 0 ? "text-(--chart-negative)" : "text-accent-brand")}>
              {fmtSigned(r.pnl)}
            </span>
          </div>
        ))}
      </div>
      {paged && (
        <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="font-mono tabular-nums">
            {start + 1}–{end} of {rows.length}
          </span>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setPage(safePage - 1)} disabled={safePage === 0} className={navBtn}>
              ‹ Prev
            </button>
            <button type="button" onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount - 1} className={navBtn}>
              Next ›
            </button>
          </div>
        </div>
      )}
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

  const [month, setMonth] = React.useState<string | null>(null);
  const active = month ?? bounds?.max ?? null;
  const [year, mon] = active
    ? [Number(active.slice(0, 4)), Number(active.slice(5, 7))]
    : [0, 0];

  const [selectedDay, setSelectedDay] = React.useState<number | null>(null);

  const cells = React.useMemo(() => {
    if (!active) return [] as (DayCell | null)[];
    const first = new Date(year, mon - 1, 1);
    const daysInMonth = new Date(year, mon, 0).getDate();
    const out: (DayCell | null)[] = Array(mondayIndex(first)).fill(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const date = `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
  }, [active, year, mon, byDate]);

  const maxAbs = React.useMemo(() => {
    let m = 0;
    for (const c of cells) if (c?.tracked) m = Math.max(m, Math.abs(c.delta));
    return m || 1;
  }, [cells]);

  const monthTotal = React.useMemo(
    () => cells.reduce((a, c) => (c?.tracked ? a + c.delta : a), 0),
    [cells],
  );

  // Default selection: latest tracked day in the active month.
  const latestTracked = React.useMemo(() => {
    for (let i = cells.length - 1; i >= 0; i--) if (cells[i]?.tracked) return cells[i]!.day;
    return null;
  }, [cells]);
  const selDay = selectedDay ?? latestTracked;
  const selDate = selDay ? `${year}-${String(mon).padStart(2, "0")}-${String(selDay).padStart(2, "0")}` : null;
  const selHit = selDate ? byDate.get(selDate) : null;
  const selHas = !!selHit && selHit.delta !== 0;

  const detailRows = React.useMemo(() => {
    if (!selDate) return [];
    return (holdingsByDate.get(selDate) ?? [])
      .filter((h) => h.pnl !== 0)
      .slice()
      .sort((a, b) => b.pnl - a.pnl);
  }, [selDate, holdingsByDate]);

  function shift(delta: number) {
    if (!active) return;
    const d = new Date(year, mon - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    setSelectedDay(null);
  }
  const canPrev = !!bounds && !!active && active > bounds.min;
  const canNext = !!bounds && !!active && active < bounds.max;

  function cellStyle(c: DayCell): React.CSSProperties {
    const border = `1px solid ${c.day === selDay ? "var(--foreground)" : "var(--divider)"}`;
    if (!c.tracked) return { background: "var(--muted)", border };
    const inten = Math.min(1, Math.abs(c.delta) / maxAbs);
    const alpha = (0.09 + 0.36 * inten).toFixed(2);
    const hue = c.delta >= 0 ? "var(--positive-rgb)" : "var(--negative-rgb)";
    return { background: `rgb(${hue} / ${alpha})`, border };
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-card px-6 py-[22px]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-5">
          <div>
            <div className="font-serif text-[17px] font-semibold">P&amp;L calendar</div>
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
                aria-label="Previous month"
                className="size-7 rounded-md border border-input bg-card text-[13px] text-muted-foreground disabled:opacity-40"
              >
                ‹
              </button>
              <input
                type="month"
                value={active}
                min={bounds?.min}
                max={bounds?.max}
                aria-label={`${MONTH_NAMES[mon - 1]} ${year} — pick a month`}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setMonth(e.target.value);
                  setSelectedDay(null);
                }}
                className="rounded-md border border-input bg-card px-2.5 py-1 text-center font-mono text-[13px] text-foreground outline-none focus:border-ring"
              />
              <button
                type="button"
                onClick={() => shift(1)}
                disabled={!canNext}
                aria-label="Next month"
                className="size-7 rounded-md border border-input bg-card text-[13px] text-muted-foreground disabled:opacity-40"
              >
                ›
              </button>
            </div>
          )}
        </div>
        {active && (
          <span className={cn("font-mono text-[14px] tabular-nums", monthTotal < 0 ? "text-(--chart-negative)" : "text-accent-brand")}>
            {fmtSigned(monthTotal)}
          </span>
        )}
      </div>

      {error ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load P&amp;L history: {error}</p>
      ) : !series ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !active ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No P&amp;L history yet — add transactions to see daily moves.</p>
      ) : (
        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[1.7fr_1fr]">
          <div>
            <div className="mb-1.5 grid grid-cols-7 gap-1.5">
              {WEEKDAYS.map((w) => (
                <div key={w} className="text-center font-mono text-[10px] tracking-[0.06em] text-faint uppercase">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {cells.map((c, i) =>
                !c ? (
                  <div key={i} className="min-h-[50px]" />
                ) : (
                  <div
                    key={i}
                    onClick={c.tracked ? () => setSelectedDay(c.day) : undefined}
                    style={cellStyle(c)}
                    className={cn(
                      "flex min-h-[50px] flex-col justify-between rounded-md px-2 py-1.5",
                      c.tracked && "cursor-pointer",
                    )}
                  >
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

          <div className="flex min-h-[200px] flex-col border-t border-border pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-[22px]">
            {selHas && selDate ? (
              <>
                <div className="shrink-0 font-mono text-[11px] tracking-[0.06em] text-faint uppercase">
                  {MONTHS[mon - 1]} {selDay}, {year}
                </div>
                <div className={cn("mt-1.5 shrink-0 font-mono text-[21px] tracking-[-0.01em] tabular-nums", selHit!.delta < 0 ? "text-(--chart-negative)" : "text-accent-brand")}>
                  {fmtSigned(selHit!.delta)}
                </div>
                <div className="mt-3.5 mb-2 shrink-0 text-[12px] text-muted-foreground">Per-holding contribution</div>
                {detailRows.length === 0 ? (
                  <p className="py-2 text-[13px] text-faint">No per-holding breakdown for this day.</p>
                ) : (
                  <ContribList key={selDate} rows={detailRows} />
                )}
              </>
            ) : (
              <p className="pt-2 text-[13px] text-faint">
                Select a day with activity to see the per-holding breakdown.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
