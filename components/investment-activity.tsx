"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { areaY, defineChart, lineY } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { scaleUtc } from "d3-scale";
import type { Tx } from "@/lib/types";
import { fmtUnits, fmtVND, MONTHS } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { TxRowActions } from "@/components/tx-row-actions";
import type { InstrumentOption } from "@/components/tx-form";
import { PanelHead } from "@/components/panel-head";
import { bareAxis, CHART_HOST_STYLE, CHART_THEME } from "@/components/ui/chart";
import { EntityAvatar } from "@/components/entity-avatar";
import { holdingLogo } from "@/lib/logos";
import { DateRange, defaultWindow } from "@/components/date-range";
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
function milVND(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${n < 0 ? "−" : ""}₫${+(abs / 1e9).toFixed(1)}bil`;
  if (abs >= 1e6) return `${n < 0 ? "−" : ""}₫${Math.round(abs / 1e6)}mil`;
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

  // Opens on the last year of activity — or on everything, when there's less than a year of
  // it. Seeded once: `today` and `minDate` don't move within a mount.
  const initial = defaultWindow(minDate, today);
  const [from, setFrom] = React.useState(initial.from);
  const [to, setTo] = React.useState(initial.to);
  const [filterHolding, setFilterHolding] = React.useState("All");
  const [filterType, setFilterType] = React.useState("All");

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

  // Averaged over the month buckets actually in range, not over the ones that had a buy —
  // a month you deployed nothing in is a real zero, and dropping it would flatter the pace.
  const monthlyAvg = bars.length ? bars.reduce((a, b) => a + b.amt, 0) / bars.length : 0;
  const best = bars.reduce<(typeof bars)[number] | null>(
    (b, m) => (m.amt > 0 && (!b || m.amt > b.amt) ? m : b),
    null,
  );

  const columns = React.useMemo<ColumnDef<Tx>[]>(
    () => [
      {
        accessorKey: "date",
        header: "Date",
        size: 110,
        cell: ({ row }) => (
          <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{row.original.date}</span>
        ),
      },
      {
        accessorKey: "instrument",
        header: "Holding",
        size: 250,
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5 overflow-hidden">
            <EntityAvatar
              name={row.original.instrument}
              color={typeColor(row.original.asset_type)}
              logo={holdingLogo(row.original.instrument)}
            />
            <span className="truncate text-[13px] font-semibold">{row.original.instrument}</span>
          </div>
        ),
      },
      {
        id: "type",
        header: "Type",
        size: 90,
        enableSorting: false,
        cell: ({ row }) => {
          const isBuy = row.original.amount >= 0;
          return (
            // Buy/Sell is a kind, so both keep the tag's shape — only the tone moves,
            // because a sell is the rare event worth spotting down a long column.
            <Badge variant="tag" className={cn(!isBuy && "bg-accent text-accent-brand")}>
              {isBuy ? "Buy" : "Sell"}
            </Badge>
          );
        },
      },
      {
        accessorKey: "quantity",
        header: "Units",
        size: 145,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
            {row.original.quantity != null ? fmtUnits(row.original.quantity) : "—"}
          </span>
        ),
      },
      {
        id: "price",
        header: "Price",
        size: 145,
        accessorFn: (t) => (t.quantity ? t.amount / t.quantity : null),
        meta: { align: "right" },
        cell: ({ row }) => {
          const t = row.original;
          const price = t.quantity ? t.amount / t.quantity : null;
          return (
            <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
              {price != null ? Math.round(price).toLocaleString("de-DE") : "—"}
            </span>
          );
        },
      },
      {
        accessorKey: "amount",
        header: "Amount",
        size: 160,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="font-mono text-[12.5px] tabular-nums">{fmtVND(row.original.amount)}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 72,
        enableSorting: false,
        cell: ({ row }) => <TxRowActions tx={row.original} instruments={options} />,
      },
    ],
    [options],
  );

  // Fixed height, not padding: a <select> derives a different intrinsic height from the
  // same padding as the date fields it sits under.
  const selectCls =
    "h-7 rounded-lg border border-input bg-pane px-2.5 font-mono text-[12px] outline-none focus:border-ring";

  return (
    <div className="mt-6 card-surface panel-body">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PanelHead title="Activity" info="Every transaction across all holdings, inside the selected date range." />
        <DateRange
          from={from}
          to={to}
          min={minDate}
          max={today}
          onChange={(f, t) => { setFrom(f); setTo(t); }}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <span className="text-[12.5px] text-muted-foreground">Filter</span>
        <select value={filterHolding} onChange={(e) => setFilterHolding(e.target.value)} className={selectCls}>
          <option value="All">All holdings</option>
          {holdingNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className={selectCls}>
          <option value="All">All types</option>
          <option value="Buy">Buy</option>
          <option value="Sell">Sell</option>
        </select>
      </div>

      {/* Summary tiles. Monthly average and Best month are scoped to the selected range
          like everything else here, so they move with the 1M/3M/YTD/1Y/All picker. */}
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-divider bg-divider lg:grid-cols-3">
        <SummaryTile label="Transactions" value={String(filtered.length)} />
        <SummaryTile label="Invested" value={fmtVND(invested)} />
        <SummaryTile label="Proceeds" value={proceeds > 0 ? fmtVND(proceeds) : "₫0"} valueCls="text-accent-brand" />
        <SummaryTile label="Net deployed" value={fmtVND(net)} />
        <SummaryTile label="Monthly average" value={fmtVND(monthlyAvg)} />
        <SummaryTile label="Best month" value={best ? `${best.label} · ${fmtVND(best.amt)}` : "—"} />
      </div>

      <div className="mt-6 mb-3 text-[13px] font-semibold text-muted-foreground">
        Cumulative capital deployed
      </div>
      <CumulativeChart txs={filtered} from={from} to={to} />

      <div className="mt-6 mb-2.5 text-[13px] font-semibold text-muted-foreground">
        Capital deployed by month
      </div>
      {/* Bars stretch to fill on desktop, but hold a floor width and scroll sideways once
          there are enough months to crush them on a phone. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-full items-end gap-2 sm:gap-3">
          {bars.map((b) => (
            <div key={b.key} className="flex min-w-[34px] flex-1 flex-col items-center gap-1.5">
              {/* The design's bar: brand blue fading out towards the baseline, so a column
                  of them reads as a field rather than as a row of solid blocks. */}
              <div className="flex h-[72px] w-full items-end">
                <div
                  className="w-full rounded-t-md bg-linear-to-b from-brand/60 to-brand/20"
                  style={{ height: `${Math.max(3, Math.round((b.amt / maxBar) * 100))}%` }}
                />
              </div>
              <div className="font-mono text-[10px] text-faint">{b.label}</div>
              <div className="font-mono text-[9.5px] text-muted-foreground tabular-nums">{milVND(b.amt)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Transactions table */}
      <div className="mt-6 border-t border-divider pt-4">
        <DataTable
          columns={columns}
          data={filtered}
          initialSorting={[{ id: "date", desc: true }]}
          pageSize={PER_PAGE}
          emptyMessage="No transactions in this range."
          storageKey="activity"
        />
      </div>
    </div>
  );
}

function SummaryTile({ label, value, valueCls }: { label: string; value: string; valueCls?: string }) {
  return (
    <div className="bg-pane px-4 py-3.5">
      <div className="text-[12.5px] text-muted-foreground">{label}</div>
      {/* Same label/figure recipe as <StatCard>, one step smaller: "Best month" carries a
          month label as well as an amount, so it's the widest thing in the grid — the whole
          row steps down rather than letting that one tile wrap. */}
      <div className={cn("mt-1.5 font-mono text-[15px] font-semibold whitespace-nowrap tabular-nums sm:text-[19px]", valueCls)}>
        {value}
      </div>
    </div>
  );
}

interface CumPoint {
  /** The instant this step lands on — the temporal x scale plots from this. */
  at: Date;
  v: number;
  date: string;
  label: string;
}

function CumulativeChart({ txs, from, to }: { txs: Tx[]; from: string; to: string }) {
  // The running total after each transaction, bookended by the range's own edges so the
  // line spans the full window even when the first buy is weeks into it.
  const pts = React.useMemo(() => {
    const rows = txs.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    const out: CumPoint[] = [{ at: new Date(from), v: 0, date: from, label: "Range start" }];
    let cum = 0;
    for (const t of rows) {
      cum += t.amount; // signed: buys add, sells subtract
      out.push({
        at: new Date(t.date),
        v: cum,
        date: t.date,
        label: `${t.instrument} · ${t.amount >= 0 ? "Buy" : "Sell"}`,
      });
    }
    out.push({ at: new Date(to), v: cum, date: to, label: "Range end" });
    return out;
  }, [txs, from, to]);

  const definition = React.useMemo(
    () =>
      defineChart({
        marks: [
          crosshair({
            x: { stroke: "var(--foreground)", strokeWidth: 1, strokeDasharray: "3 3", strokeOpacity: 0.4 },
            y: false,
            marker: { radius: 4.5, fill: "var(--card)", stroke: "var(--chart-gold)", strokeWidth: 2 },
          }),
          areaY(pts, { x: "at", y1: 0, y2: "v", fill: "rgb(var(--gold-rgb) / 0.15)", fillOpacity: 1 }),
          lineY(pts, { x: "at", y: "v", stroke: "var(--chart-gold)", strokeWidth: 2 }),
        ],
        // Fixed to the picked window, not to the transactions: an empty stretch at either
        // end is information — it is when you weren't buying.
        x: { scale: scaleUtc().domain([new Date(from), new Date(to)]), axis: bareAxis<Date>() },
        // `milVND` renders zero as an em dash, which is right in a table cell reading "no
        // spend this month" and wrong on an axis, where the baseline has to name itself.
        y: {
          scale: scaleLinear,
          nice: true,
          axis: bareAxis<number>({ format: (v) => (v === 0 ? "₫0" : milVND(v)) }),
        },
        theme: CHART_THEME,
        // The date is what you point at, and the steps are irregular — an unbounded radius
        // means a long flat run between two buys is still reachable anywhere along it.
        focus: "nearest-x",
        maxFocusDistance: Number.POSITIVE_INFINITY,
        tooltip: {
          use: tooltip,
          content: (points) => {
            const p = points[0]?.datum;
            if (!p) return { rows: [] };
            return {
              title: `${p.date} · ${p.label}`,
              rows: [{ label: "Deployed", value: fmtVND(p.v), color: "var(--chart-gold)" }],
            };
          },
        },
      }),
    [pts, from, to],
  );

  return (
    <Chart
      definition={definition}
      height={150}
      initialWidth={800}
      className="w-full"
      style={CHART_HOST_STYLE}
      ariaLabel="Capital deployed over the selected range"
    />
  );
}
