"use client";

import * as React from "react";
import type { Tx } from "@/lib/types";
import { fmtVND, MONTHS } from "@/lib/format";
import { TxRowActions } from "@/components/tx-row-actions";
import type { InstrumentOption } from "@/components/tx-form";
import { cn } from "@/lib/utils";

const TYPE_COLORS: Record<string, string> = {
  Funds: "var(--chart-1)",
  Stocks: "var(--chart-2)",
  Crypto: "var(--chart-3)",
  "Real Estate": "var(--chart-4)",
};
const typeColor = (t: string) => TYPE_COLORS[t] ?? "var(--chart-5)";

const PER_PAGE = 6;

function isoNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function numFmt(n: number): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: 4 });
}
function trVND(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${n < 0 ? "−" : ""}₫${Math.round(abs / 1e6)}tr`;
  if (abs === 0) return "—";
  return `${n < 0 ? "−" : ""}₫${Math.round(abs / 1e3)}k`;
}

export function InvestmentActivity({
  txs,
  options,
}: {
  txs: Tx[];
  options: InstrumentOption[];
}) {
  const today = isoNow();
  const year = today.slice(0, 4);
  const minDate = txs.length ? txs.reduce((m, t) => (t.date < m ? t.date : m), txs[0].date) : `${year}-01-01`;

  const [from, setFrom] = React.useState(`${year}-01-01`);
  const [to, setTo] = React.useState(today);
  const [filterHolding, setFilterHolding] = React.useState("All");
  const [filterType, setFilterType] = React.useState("All");
  const [page, setPage] = React.useState(0);

  const holdingNames = React.useMemo(
    () => Array.from(new Set(txs.map((t) => t.instrument))).sort(),
    [txs],
  );

  const filtered = React.useMemo(() => {
    return txs
      .filter((t) => t.date >= from && t.date <= to)
      .filter((t) => filterHolding === "All" || t.instrument === filterHolding)
      .filter((t) => {
        if (filterType === "All") return true;
        return filterType === "Buy" ? t.amount >= 0 : t.amount < 0;
      })
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  }, [txs, from, to, filterHolding, filterType]);

  const invested = filtered.filter((t) => t.amount >= 0).reduce((a, t) => a + t.amount, 0);
  const proceeds = filtered.filter((t) => t.amount < 0).reduce((a, t) => a - t.amount, 0);
  const net = invested - proceeds;

  // Monthly capital deployed (buys) within range.
  const bars = React.useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const t of filtered) if (t.amount >= 0) {
      const k = t.date.slice(0, 7);
      byMonth.set(k, (byMonth.get(k) ?? 0) + t.amount);
    }
    // month buckets from `from` to `to`
    const out: { key: string; label: string; amt: number }[] = [];
    let y = Number(from.slice(0, 4));
    let m = Number(from.slice(5, 7));
    const ey = Number(to.slice(0, 4));
    const em = Number(to.slice(5, 7));
    let guard = 0;
    while ((y < ey || (y === ey && m <= em)) && guard++ < 60) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      out.push({ key, label: MONTHS[m - 1], amt: byMonth.get(key) ?? 0 });
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }, [filtered, from, to]);
  const maxBar = Math.max(1, ...bars.map((b) => b.amt));

  const presets: { label: string; from: string }[] = [
    { label: "1M", from: shiftMonths(today, -1) },
    { label: "3M", from: shiftMonths(today, -3) },
    { label: "YTD", from: `${year}-01-01` },
    { label: "All", from: minDate },
  ];

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE);
  const rowFirst = filtered.length ? safePage * PER_PAGE + 1 : 0;
  const rowLast = Math.min(filtered.length, (safePage + 1) * PER_PAGE);

  // Fixed height, not padding: a <select> and a date field derive different intrinsic
  // heights from the same padding, and the row sits next to the range pills.
  const selectCls =
    "h-7 rounded-lg border border-input bg-card px-2.5 font-mono text-[12px] outline-none focus:border-ring";
  const pill = (active: boolean) =>
    cn(
      "cursor-pointer rounded-md border-0 px-[11px] py-[5px] font-mono text-[11.5px] transition-colors",
      active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="mt-6 rounded-xl border border-border bg-card px-6 py-[22px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-serif text-[19px] font-semibold">Activity</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            Transactions across all holdings in the selected date range
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-[3px] rounded-lg bg-background p-[3px]">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className={pill(from === p.from && to === today)}
                onClick={() => { setFrom(p.from); setTo(today); setPage(0); }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className={selectCls} />
            <span className="text-faint">–</span>
            <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className={selectCls} />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <span className="font-mono text-[10px] tracking-[0.06em] text-faint uppercase">Filter</span>
        <select value={filterHolding} onChange={(e) => { setFilterHolding(e.target.value); setPage(0); }} className={selectCls}>
          <option value="All">All holdings</option>
          {holdingNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(0); }} className={selectCls}>
          <option value="All">All types</option>
          <option value="Buy">Buy</option>
          <option value="Sell">Sell</option>
        </select>
      </div>

      {/* Summary tiles */}
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-divider bg-divider lg:grid-cols-4">
        <SummaryTile label="Transactions" value={String(filtered.length)} />
        <SummaryTile label="Invested" value={fmtVND(invested)} />
        <SummaryTile label="Proceeds" value={proceeds > 0 ? fmtVND(proceeds) : "₫0"} valueCls="text-accent-brand" />
        <SummaryTile label="Net deployed" value={fmtVND(net)} />
      </div>

      <div className="mt-6 mb-3 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
        Cumulative capital deployed
      </div>
      <CumulativeChart txs={filtered} from={from} to={to} />

      <div className="mt-6 mb-2.5 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
        Capital deployed by month
      </div>
      {/* Bars stretch to fill on desktop, but hold a floor width and scroll sideways once
          there are enough months to crush them on a phone. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-full items-end gap-2 sm:gap-3">
          {bars.map((b) => (
            <div key={b.key} className="flex min-w-[34px] flex-1 flex-col items-center gap-1.5">
              <div className="flex h-[54px] w-full items-end">
                <div className="w-full rounded-t-[3px] bg-chart-1" style={{ height: `${Math.max(3, Math.round((b.amt / maxBar) * 100))}%` }} />
              </div>
              <div className="font-mono text-[10px] text-faint">{b.label}</div>
              <div className="font-mono text-[9.5px] text-muted-foreground tabular-nums">{trVND(b.amt)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Transactions table */}
      <div className="mt-6 overflow-x-auto border-t border-divider">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[88px_128px_58px_1fr_1fr_118px_56px] gap-3 py-3 font-mono text-[10px] tracking-[0.06em] text-faint uppercase">
            <span>Date</span><span>Holding</span><span>Type</span>
            <span className="text-right">Units</span><span className="text-right">Price</span>
            <span className="text-right">Amount</span><span />
          </div>
          {/* Fixed-height body so a partial last page (or an empty range) keeps the
              table the same size instead of collapsing. */}
          <div className="h-[294px] overflow-y-hidden">
            {pageRows.length === 0 ? (
              <div className="border-t border-divider-soft py-8 text-center text-[13px] text-faint">
                No transactions in this range.
              </div>
            ) : (
              pageRows.map((t) => {
                const isBuy = t.amount >= 0;
                const price = t.quantity ? t.amount / t.quantity : null;
                return (
                  <div key={t.id} className="grid grid-cols-[88px_128px_58px_1fr_1fr_118px_56px] items-center gap-3 border-t border-divider-soft py-2.5">
                    <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{t.date}</span>
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: typeColor(t.asset_type) }} />
                      <span className="truncate font-mono text-[12.5px]">{t.instrument}</span>
                    </div>
                    <span
                      className={cn(
                        "rounded-[5px] px-[7px] py-0.5 text-center font-mono text-[10px]",
                        isBuy ? "bg-divider-soft text-muted-foreground" : "bg-accent text-accent-brand",
                      )}
                    >
                      {isBuy ? "Buy" : "Sell"}
                    </span>
                    <span className="text-right font-mono text-[12px] text-muted-foreground tabular-nums">{t.quantity != null ? numFmt(t.quantity) : "—"}</span>
                    <span className="text-right font-mono text-[12px] text-muted-foreground tabular-nums">{price != null ? numFmt(Math.round(price)) : "—"}</span>
                    <span className="text-right font-mono text-[12.5px] tabular-nums">{fmtVND(t.amount)}</span>
                    <TxRowActions tx={t} instruments={options} />
                  </div>
                );
              })
            )}
          </div>
          {filtered.length > 0 && (
            <div className="mt-1.5 flex items-center justify-between border-t border-divider pt-3.5">
              <span className="font-mono text-[11.5px] text-faint tabular-nums">
                {rowFirst}–{rowLast} of {filtered.length}
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage(safePage - 1)}
                  disabled={safePage === 0}
                  className="rounded-md border border-input bg-card px-3 py-1.5 font-mono text-[11.5px] disabled:text-disabled-foreground"
                >
                  ‹ Prev
                </button>
                <button
                  type="button"
                  onClick={() => setPage(safePage + 1)}
                  disabled={safePage >= totalPages - 1}
                  className="rounded-md border border-input bg-card px-3 py-1.5 font-mono text-[11.5px] disabled:text-disabled-foreground"
                >
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, valueCls }: { label: string; value: string; valueCls?: string }) {
  return (
    <div className="bg-card px-4 py-3.5">
      <div className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">{label}</div>
      <div className={cn("mt-1.5 font-mono text-[19px] tabular-nums", valueCls)}>{value}</div>
    </div>
  );
}

interface CumPoint {
  x: number;
  v: number;
  date: string;
  label: string;
}

function CumulativeChart({ txs, from, to }: { txs: Tx[]; from: string; to: string }) {
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);
  const W = 1000;
  const H = 150;
  const rows = txs.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const d0 = new Date(from).getTime();
  const d1 = new Date(to).getTime();
  const span = Math.max(1, d1 - d0);
  let cum = 0;
  const pts: CumPoint[] = [{ x: 0, v: 0, date: from, label: "Range start" }];
  for (const t of rows) {
    cum += t.amount; // signed: buys add, sells subtract
    const x = (new Date(t.date).getTime() - d0) / span;
    pts.push({ x: Math.max(0, Math.min(1, x)), v: cum, date: t.date, label: `${t.instrument} · ${t.amount >= 0 ? "Buy" : "Sell"}` });
  }
  pts.push({ x: 1, v: cum, date: to, label: "Range end" });
  const max = Math.max(1, ...pts.map((p) => p.v));
  const X = (f: number) => f * W;
  const Y = (v: number) => H - (v / max) * H;
  let line = "";
  pts.forEach((p, i) => { line += (i ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.v).toFixed(1) + " "; });
  const area = line + "L" + W + " " + H + " L 0 " + H + " Z";

  const hi = hoverIdx != null && pts[hoverIdx] ? hoverIdx : null;
  const tipLeft = hi != null ? Math.max(8, Math.min(92, (X(pts[hi].x) / W) * 100)) : 0;

  function onMove(e: React.MouseEvent) {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.abs(pts[i].x - f);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best !== hoverIdx) setHoverIdx(best);
  }

  return (
    <div className="relative">
      <div className="relative ml-[52px] h-[150px]">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 block h-full w-full">
          <line x1={0} x2={W} y1={H - 1} y2={H - 1} stroke="var(--grid)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path className="animate-fade-in" d={area} fill="rgb(var(--gold-rgb) / 0.15)" />
          <path className="animate-draw-line" pathLength={1} d={line} fill="none" stroke="var(--chart-gold)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {hi != null && (
            <>
              <line x1={X(pts[hi].x)} x2={X(pts[hi].x)} y1={0} y2={H} stroke="var(--foreground)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" opacity={0.4} />
              <circle cx={X(pts[hi].x)} cy={Y(pts[hi].v)} r={4} fill="var(--card)" stroke="var(--chart-gold)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </>
          )}
          <rect x={0} y={0} width={W} height={H} fill="transparent" style={{ cursor: "crosshair" }} onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)} />
        </svg>
        <div className="absolute -top-1.5 -left-[52px] font-mono text-[10px] text-faint">₫{Math.round(max / 1e6)}tr</div>
        <div className="absolute -bottom-0.5 -left-[52px] font-mono text-[10px] text-faint">₫0</div>
        {hi != null && (
          <div className="pointer-events-none absolute top-1.5 z-10 -translate-x-1/2 rounded-md bg-foreground px-2.5 py-1.5 whitespace-nowrap" style={{ left: `${tipLeft}%` }}>
            <div className="mb-0.5 font-mono text-[10px] text-background/60">{pts[hi].date} · {pts[hi].label}</div>
            <div className="font-mono text-[12.5px] tabular-nums text-background">Deployed {fmtVND(pts[hi].v)}</div>
          </div>
        )}
      </div>
      <div className="mt-1.5 ml-[52px] flex justify-between font-mono text-[10px] text-faint tabular-nums">
        <span>{from}</span><span>{to}</span>
      </div>
    </div>
  );
}

function shiftMonths(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1 + delta, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
