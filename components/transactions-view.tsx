"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { areaY, defineChart, lineY, rect } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import type { BrushRange } from "@tanstack/charts/interaction/brush";
import { controlledSignal } from "@tanstack/charts/interaction/signal";
import {
  interactiveColorLegend, type InteractiveColorLegendChange,
} from "@tanstack/charts/legend";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { stackRowsY } from "@tanstack/charts/transform/stack";
import { scaleUtc } from "d3-scale";
import { Download } from "lucide-react";
import type { Tx } from "@/lib/types";
import { fmtUnits, fmtVND, MONTHS } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { AddRecurringDialog } from "@/components/add-recurring-dialog";
import { AddTxDialog } from "@/components/add-tx-dialog";
import { TxRowActions } from "@/components/tx-row-actions";
import type { InstrumentOption } from "@/components/tx-form";
import { PageHeader } from "@/components/page-header";
import { PanelHead } from "@/components/panel-head";
import {
  bareAxis, CHART_HOST_STYLE, CHART_THEME, CHIP_LEGEND_CLASS, ChipLegendStyle,
  INITIAL_PANEL_WIDTH, legendChartMetrics, legendItemWidth, useLegendBand, usePanelWidth,
} from "@/components/ui/chart";
import { BRUSH_MIN_POINTS, SeriesBrush, useDateWindow } from "@/components/chart-brush";
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

/**
 * The Transactions page: every transaction across every holding, with the date window, the
 * filters, the two capital-deployed charts and the table all reading the same selection.
 *
 * It was a panel on the Investments page until the two were split. A holding is a position
 * you hold now; a transaction is a thing that happened on a date — they answer different
 * questions, and the one page had to carry two date models at once (a live valuation and a
 * window over history) to serve both. `/investments` now keeps the positions and links each
 * holding through to here, pre-filtered.
 */
export function TransactionsView({
  txs,
  options,
  initialHolding = "All",
}: {
  txs: Tx[];
  options: InstrumentOption[];
  /** From `?holding=` — how a holding on `/investments` opens its own history. Only the
   *  initial value: the picker below owns it from the first render on, so changing the
   *  filter here doesn't rewrite the URL and the Back button still goes back a page. */
  initialHolding?: string;
}) {
  const today = isoNow();
  const year = today.slice(0, 4);
  const minDate = txs.length ? txs.reduce((m, t) => (t.date < m ? t.date : m), txs[0].date) : `${year}-01-01`;

  // Opens on the last year of activity — or on everything, when there's less than a year of
  // it. Seeded once: `today` and `minDate` don't move within a mount.
  //
  // Arriving pre-filtered to one holding is the exception, and it has to be: a position you
  // stopped adding to two years ago would open on a year that contains none of it, so the
  // link from /investments would land on an empty page. Scoped to a holding, the window
  // opens on that holding's whole history instead. `min` below stays the portfolio's, so
  // "All" still reaches everything.
  const initial =
    initialHolding === "All"
      ? defaultWindow(minDate, today)
      : { from: txs.reduce((m, t) => (t.instrument === initialHolding && t.date < m ? t.date : m), today), to: today };
  const [from, setFrom] = React.useState(initial.from);
  const [to, setTo] = React.useState(initial.to);
  const [filterHolding, setFilterHolding] = React.useState(initialHolding);
  const [filterType, setFilterType] = React.useState("All");

  const holdingNames = React.useMemo(
    () => Array.from(new Set(txs.map((t) => t.instrument))).sort(),
    [txs],
  );

  // Everything the holding and type pickers admit, over the whole history.
  const selected = React.useMemo(() => {
    return txs
      .filter((t) => filterHolding === "All" || t.instrument === filterHolding)
      .filter((t) => {
        if (filterType === "All") return true;
        return filterType === "Buy" ? t.amount >= 0 : t.amount < 0;
      });
  }, [txs, filterHolding, filterType]);

  // The picked window — what the brush strip is drawn over, end to end, so an untouched
  // brush spans all of it whatever the preset says.
  const inRange = React.useMemo(
    () => selected.filter((t) => t.date >= from && t.date <= to),
    [selected, from, to],
  );
  const strip = React.useMemo(() => stripSeries(inRange, from, to), [inRange, from, to]);

  // A zoom inside that window. The picker sets how much history is on the table; the handles
  // read a stretch of it — and everything below reads the stretch, tiles and table included,
  // because a panel quoting two different windows at once is unreadable.
  const zoom = useDateWindow(strip);
  const zFrom = zoom.range?.start ?? from;
  const zTo = zoom.range?.end ?? to;

  const filtered = React.useMemo(() => {
    return inRange
      .filter((t) => t.date >= zFrom && t.date <= zTo)
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  }, [inRange, zFrom, zTo]);

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
    let y = Number(zFrom.slice(0, 4));
    let m = Number(zFrom.slice(5, 7));
    const ey = Number(zTo.slice(0, 4));
    const em = Number(zTo.slice(5, 7));
    let guard = 0;
    while ((y < ey || (y === ey && m <= em)) && guard++ < 60) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      out.push({ key, label: MONTHS[m - 1], amt: byMonth.get(key) ?? 0 });
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }, [filtered, zFrom, zTo]);

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
    <div>
      {/* Export CSV lives here rather than on /investments: the file it downloads is the
          transaction ledger, row for row — the same thing this page is a view of. */}
      <PageHeader
        title="Transactions"
        className="mb-4"
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<a href="/export.csv" download />}>
              <Download className="size-3.5" />
              Export CSV
            </Button>
            <AddRecurringDialog instruments={options} />
            <AddTxDialog instruments={options} />
          </>
        }
      >
        Every buy and sell across your holdings, and what they add up to over time.
      </PageHeader>

      <div className="card-surface panel-body">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <PanelHead title="Activity" info="Every transaction across all holdings, inside the selected date range." />
          <div className="flex flex-wrap items-center justify-end gap-3">
            <DateRange
              from={from}
              to={to}
              min={minDate}
              max={today}
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
        <CumulativeChart
          txs={filtered}
          from={zFrom}
          to={zTo}
          strip={strip}
          handles={zoom.range}
          onHandles={zoom.setRange}
        />

        <div className="mt-6 mb-2.5 text-[13px] font-semibold text-muted-foreground">
          Capital deployed by month
        </div>
        <DeployedByMonth txs={filtered} months={bars} />

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

/**
 * How many samples the context strip under the cumulative chart is drawn from.
 *
 * The strip is sampled on an even *time* grid rather than being handed the transaction steps
 * themselves, because `scalePoint` spaces its values evenly: built from the steps, a year of
 * not buying and a busy fortnight would sit the same distance apart, and the window you
 * dragged would not line up with the axis above it.
 *
 * The count is also the brush's granularity, since it snaps to the values it is given —
 * roughly a day and a half over a year's range, and never finer than a day, which is as
 * precise as a window over a spending history needs to be.
 */
const STRIP_SAMPLES = 240;

/**
 * The picked window's running total at one sample per grid step — the shape the brush is
 * dragged over.
 *
 * Sampled on an even *time* grid rather than from the transaction steps, because `scalePoint`
 * spaces values evenly: built from the steps, a year of not buying and a busy fortnight would
 * sit the same distance apart, and the window you dragged would not line up with the chart
 * above it.
 *
 * It lives beside the panel rather than inside the chart because the brush over it is the
 * panel's zoom: the tiles and the table read the same selection.
 */
function stripSeries(txs: Tx[], from: string, to: string): { date: string; v: number }[] {
  const DAY = 86_400_000;
  const startMs = Date.parse(`${from}T00:00:00Z`);
  const endMs = Date.parse(`${to}T00:00:00Z`);
  if (!(endMs > startMs)) return [];
  const stepMs = Math.max(DAY, Math.ceil((endMs - startMs) / STRIP_SAMPLES / DAY) * DAY);
  const rows = txs.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const out: { date: string; v: number }[] = [];
  let i = 0;
  let cum = 0;
  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const date = new Date(ms).toISOString().slice(0, 10);
    while (i < rows.length && rows[i].date <= date) cum += rows[i++].amount;
    out.push({ date, v: cum });
  }
  return out;
}

function CumulativeChart({
  txs,
  from,
  to,
  strip,
  handles,
  onHandles,
}: {
  /** The brushed window's transactions — what the curve draws. */
  txs: Tx[];
  /** The brushed window's bounds, which the curve's x domain is fixed to. */
  from: string;
  to: string;
  /** The picked window, end to end — so an untouched brush spans the whole strip. */
  strip: { date: string; v: number }[];
  handles: BrushRange<string> | null;
  onHandles: (next: BrushRange<string> | null) => void;
}) {

  // The running total across the window, bookended by its own edges so the line spans the
  // full window even when the first buy is weeks into it.
  //
  // It starts at zero rather than carrying in what was deployed before `from`, which is what
  // makes it the same claim as the "Invested" tile above and the table below: everything in
  // this panel reads the window, and a curve that opened partway up the axis would be the one
  // thing here quoting a figure from outside it.
  const pts = React.useMemo(() => {
    const rows = txs.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    let cum = 0;
    const out: CumPoint[] = [{ at: new Date(from), v: 0, date: from, label: "Range start" }];
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
        // Fixed to the window, not to the transactions: an empty stretch at either end is
        // information — it is when you weren't buying.
        x: {
          scale: scaleUtc().domain([new Date(from), new Date(to)]),
          axis: bareAxis<Date>(),
        },
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
    <div>
      <Chart
        definition={definition}
        height={260}
        initialWidth={800}
        className="w-full"
        style={CHART_HOST_STYLE}
        ariaLabel="Capital deployed over the selected range"
      />
      {/* The strip is the picked window end to end, so the handles open at its two edges
          whatever the preset — narrowing from there is the brush's own state, which the
          "Reset zoom" beside the picker undoes. */}
      {handles && strip.length >= BRUSH_MIN_POINTS && (
        <div className="mt-1.5">
          <SeriesBrush
            data={strip}
            field="v"
            color="var(--chart-gold)"
            range={handles}
            onRange={onHandles}
            label="Drag to narrow the capital-deployed window"
          />
        </div>
      )}
    </div>
  );
}

/** The five hues the theme defines, as chart series slots. */
const SERIES_HUES = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)",
];

/**
 * How many holdings keep a colour of their own before the rest are folded into one segment.
 *
 * The ceiling is the palette, not taste. The theme defines five chart hues; the half-strength
 * lap below stretches those to ten paints that can still be told apart where they meet inside
 * a column, and past that two holdings in the same month would be painted the same. Eight
 * named plus "Other" stays inside that with a slot to spare, and — more to the point — keeps
 * the legend a line you read rather than a wall of chips over a short chart. A portfolio's
 * long tail is a hairline of a segment anyway; "Other" says so in one honest row.
 */
const TOP_INSTRUMENTS = 8;

/** The fold-in row. A name, because it is a series key like any other. */
const OTHER = "Other";

/**
 * A slot's paint. Same trick as the subscription forecast: every second lap round the five
 * hues comes back at half strength, and the weaker variant mixes toward *transparent* rather
 * than toward the card, so it reads as the same hue in Daylight and in Midnight.
 *
 * Colour follows the stack position here rather than the holding, which is the opposite of
 * `TYPE_COLORS` above and deliberate: the series set is itself derived from the window (the
 * top eight *within the picked range*), so there is no stable list of holdings to hand fixed
 * slots to. What a reader needs instead is the guarantee that no two segments of one column
 * share a paint, and ranking gives exactly that.
 */
function slotFill(i: number): string {
  const hue = SERIES_HUES[i % SERIES_HUES.length];
  return Math.floor(i / SERIES_HUES.length) % 2 === 0
    ? hue
    : `color-mix(in srgb, ${hue} 55%, transparent)`;
}

/** One rectangle: what a single holding bought in a single month. */
interface DeployedSegment {
  month: string;
  /** Tooltip heading — carries the year, which the axis label drops. */
  full: string;
  /** The series key: a holding's name, or `OTHER`. */
  name: string;
  amount: number;
  /** Everything the column deployed — the figure its height means. */
  total: number;
}

/**
 * Capital deployed each month, split by holding.
 *
 * Buys only: a sell is money coming back out, and a column that netted the two would read as
 * a quiet month rather than as a busy one you also took profit in. A month that deployed
 * nothing keeps its column — that zero is the same information the "monthly average" tile is
 * built on.
 */
function DeployedByMonth({
  txs,
  months,
}: {
  txs: Tx[];
  /** Every month in the window, in order, with the total the summary tiles quote. Passed in
   *  rather than re-derived, so the columns and the tiles can never disagree. */
  months: { key: string; label: string; amt: number }[];
}) {
  const plan = React.useMemo(() => {
    const buys = txs.filter((t) => t.amount >= 0);

    const totals = new Map<string, number>();
    for (const t of buys) totals.set(t.instrument, (totals.get(t.instrument) ?? 0) + t.amount);
    // Ties broken by name, so two equal holdings don't swap places in the stack between
    // renders.
    const ranked = [...totals.entries()].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
    );
    const top = ranked.slice(0, TOP_INSTRUMENTS).map(([name]) => name);
    const named = new Set(top);
    // "Other" last, and so always the cap of the column: a fold-in row that moved around the
    // stack as the range changed would read as a holding.
    const series = ranked.length > top.length ? [...top, OTHER] : top;

    const cells = new Map<string, number>();
    for (const t of buys) {
      const key = `${t.date.slice(0, 7)} ${named.has(t.instrument) ? t.instrument : OTHER}`;
      cells.set(key, (cells.get(key) ?? 0) + t.amount);
    }

    const segments: DeployedSegment[] = [];
    for (const m of months) {
      for (const name of series) {
        const amount = cells.get(`${m.key} ${name}`) ?? 0;
        if (!amount) continue;
        segments.push({
          month: m.key,
          full: `${m.label} ${m.key.slice(0, 4)}`,
          name,
          amount,
          total: m.amt,
        });
      }
    }
    return { segments, series };
  }, [txs, months]);

  /**
   * The one holding the reader has singled out, if any.
   *
   * A stack answers "what did I deploy in March"; it is bad at "how did *this* holding go
   * across the year", because a segment's height is only readable against a baseline that
   * moves under it. Isolating drops the holding to the floor in every month, which is the
   * only way to compare its own months to each other.
   */
  const [only, setOnly] = React.useState<string | null>(null);

  const [width, measure] = usePanelWidth(INITIAL_PANEL_WIDTH);
  const [band, watchLegend] = useLegendBand();

  const shown = React.useMemo(
    () => (only === null ? plan.segments : plan.segments.filter((s) => s.name === only)),
    [plan.segments, only],
  );
  // The stacking order is spelled out rather than inferred: biggest at the base of every
  // column, so the heaviest holding is the one the eye measures against the axis.
  const order = React.useMemo(
    () => (only === null ? plan.series : [only]),
    [plan.series, only],
  );
  const stacked = React.useMemo(
    () => stackRowsY(shown, { x: "month", y: "amount", z: "name", order }),
    [shown, order],
  );

  const monthKeys = React.useMemo(() => months.map((m) => m.key), [months]);

  const definition = React.useMemo(
    () =>
      defineChart({
        marks: [
          // Underlay, so the hovered month lights up behind its column rather than washing
          // over it. `inset` is negative to widen the band back past the bar's own padding,
          // which makes the cursor read as "this month" and not "this bar".
          crosshair({
            x: { band: { fill: "var(--muted)", fillOpacity: 1, inset: -5, radius: 4 } },
            y: false,
          }),
          rect(stacked, {
            x: "x",
            y1: "y1",
            y2: "y2",
            // The holding is the series, and saying so is what makes a column's segments one
            // thing: grouped focus collects one point per series at the hovered month, so
            // without `z` every segment would look like the same series and the tooltip would
            // collapse to a single row.
            z: "z",
            key: (s) => `${s.month}:${s.name}`,
            // A hairline in the panel's own colour, so two holdings that land near the same
            // hue still read as two segments where they meet.
            stroke: "var(--card)",
            strokeWidth: 1,
            inset: 0,
          }),
        ],
        x: {
          // An instance, not a factory: the domain is ours — every month in the window,
          // including the ones that deployed nothing — and only a configured scale keeps its
          // own.
          scale: scaleBand<string>().domain(monthKeys).padding(0.26),
          axis: bareAxis<string>({ format: (m) => MONTHS[Number(m.slice(5, 7)) - 1] }),
        },
        // `milVND` renders zero as an em dash, which is right in a table cell reading "no
        // spend this month" and wrong on an axis, where the baseline has to name itself.
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: bareAxis<number>({ format: (v) => (v === 0 ? "₫0" : milVND(v)) }),
        },
        color: {
          // The full domain either way, so isolating a holding doesn't drop the others out of
          // the legend — the legend is how you get back.
          domain: plan.series,
          range: plan.series.map((name, i) =>
            name === OTHER ? "var(--muted-foreground)" : slotFill(i),
          ),
          /**
           * The legend is the library's: pressed states, keyboard order, layout and the
           * swatches all come with it. What stays ours is the *policy* — the change event
           * names the holding that was clicked, and we read that as "show me only this one"
           * rather than as "hide this one".
           *
           * Isolating by re-stacking only the rows we want, rather than by letting the legend
           * hide the series, is deliberate: the legend filters after the scales are resolved,
           * so a ₫2mil holding would keep being drawn against a ₫90mil axis and stay
           * invisible.
           */
          legend: interactiveColorLegend<string>({
            visible: controlledSignal<readonly string[], InteractiveColorLegendChange<string>>(
              only === null ? plan.series : [only],
              (_next, { reason }) => {
                setOnly((current) => (current === reason.value ? null : reason.value));
              },
            ),
            // Under the plot, matching the subscription forecast — and out of the way of the
            // tooltip, which anchors to the hovered column and opens upward.
            placement: "bottom",
            itemWidth: legendItemWidth(width),
            format: (name) => name,
            ariaLabel: "Show one holding",
            itemAriaLabel: (name, { visible }) =>
              visible && only !== null ? "Show every holding" : `Show only ${name}`,
          }),
        },
        theme: CHART_THEME,
        // Hovering anywhere in a column means the whole column: a stack is only readable if
        // you can see every holding that adds up to the height at once.
        focus: "group-x",
        focusRing: false,
        tooltip: {
          use: tooltip,
          anchor: "group-center",
          placement: ["top", "right", "left", "bottom"],
          // Rows in the colour scale's order, which is the stacking order — the tooltip lists
          // a column's holdings the same way the column stacks them.
          sort: "color-domain",
          content: (points) => {
            const first = points[0]?.datum;
            if (!first) return { rows: [] };
            return {
              // The month's total belongs in the heading: it's the figure the column height
              // means, and the rows beneath it are what add up to it. Isolated, the column
              // height *is* the row below, so quoting the month's full deployment would be a
              // number the chart isn't showing — the month alone is honest.
              title: only === null ? `${first.full} · ${fmtVND(first.total)}` : first.full,
              rows: points.map((point) => ({
                label: point.datum.name,
                value: fmtVND(point.datum.amount),
                color: point.color,
              })),
            };
          },
        },
      }),
    [stacked, monthKeys, plan.series, only, width],
  );

  if (!plan.series.length) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nothing bought in this range.
      </p>
    );
  }

  // Derived rather than fixed, because the legend is drawn *inside* the chart's box and takes
  // its rows out of the plot: nine chips wrap to two rows on a desktop and to five on a phone,
  // and a fixed height would hand the phone's columns whatever was left. The panel pays for
  // the legend instead. A shallower curve than the default — twelve stacked columns need more
  // height to separate their segments than a line does to show its shape.
  const metrics = legendChartMetrics(plan.series.length, width, band, (w) =>
    w < 520 ? 1.15 : w < 820 ? 1.7 : 2.4,
  );

  return (
    <div
      ref={(node) => {
        measure(node);
        watchLegend(node);
      }}
    >
      <ChipLegendStyle />
      <Chart
        definition={definition}
        height={metrics.height}
        initialWidth={INITIAL_PANEL_WIDTH}
        className={cn("w-full", CHIP_LEGEND_CLASS)}
        style={{ ...CHART_HOST_STYLE, "--legend-chip": `${metrics.chip}px` } as React.CSSProperties}
        ariaLabel="Capital deployed each month, split by holding"
      />
    </div>
  );
}
