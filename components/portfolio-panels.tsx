"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { defineChart } from "@tanstack/charts";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import { Chart } from "@tanstack/charts/react";
import { tooltip } from "@tanstack/charts/tooltip";
import { portal } from "@tanstack/charts/tooltip/portal";
import type { HoldingPnlPoint, LivePayload } from "@/lib/types";
import { fmtMilVND, fmtSigned } from "@/lib/format";
import { sparkPaths } from "@/components/net-worth";
import { EntityAvatar } from "@/components/entity-avatar";
import { PanelHead } from "@/components/panel-head";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CHART_HOST_STYLE, CHART_MOTION, CHART_THEME } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

/**
 * The two portfolio panels — what you hold, split by type and listed one per row.
 *
 * They opened the dashboard for a long time. They live on Investments now, next to the
 * holdings they describe: the dashboard's job is net worth and the shape of the year, and
 * an allocation donut is a question about the portfolio, which is a page of its own.
 * Exported rather than inlined there because they are driven by `LivePayload`, so they move
 * as a price tick lands — see `usePnlHistory`.
 */

/** Fixed slot per asset type — colour follows the entity, never its rank. Exported because
 *  the Investments page tints its own rows from the same map, and two copies of it drifted
 *  the moment one of them gained a type. */
export const TYPE_COLORS: Record<string, string> = {
  Funds: "var(--chart-1)",
  Stocks: "var(--chart-2)",
  Crypto: "var(--chart-3)",
  "Real Estate": "var(--chart-4)",
};
export const typeColor = (t: string) => TYPE_COLORS[t] ?? "var(--chart-5)";

/** Sentinel for the Holdings filter's "no filter" option — Base UI's Select needs a real
 *  value, and "" is indistinguishable from a cleared selection. */
const ALL_TYPES = "__all__";
/** Rows per page in the Holdings panel. */
const HOLDINGS_PAGE_SIZE = 4;

/** Roughly one holdings row, in px — 24px of vertical padding around a 28px mark. Used only
 *  as a `min-height` for the list, so the panel keeps its size on a part-full last page or
 *  an empty search. Being a little off costs a few px of slack, never a clipped row. */
const HOLDINGS_ROW_PX = 57;

/** Holdings a slice's hover card names before it summarises the tail into one line. */
const SLICE_TIP_ROWS = 6;

/** Thickness of the allocation ring, in the donut's own pixels. */
const RING = 26;
/** The donut is a fixed square — a ring reads by its shape, not by its width. */
const SIZE = 172;
export function AllocationCard({ payload }: { payload: LivePayload }) {
  const total = payload.allocation.reduce((a, x) => a + x.value, 0) || 1;
  const rows = React.useMemo(() => {
    const sum = payload.allocation.reduce((a, x) => a + x.value, 0) || 1;
    return payload.allocation
      .slice()
      .sort((a, b) => b.value - a.value)
      .map((a) => ({ ...a, pct: (a.value / sum) * 100, color: typeColor(a.type) }));
  }, [payload.allocation]);

  // The positions inside each slice, largest first. A slice is a sum, and the question it
  // always raises — *which* holdings is that? — is one hover away rather than a trip to the
  // Holdings panel with its own filter. Grouped once for all slices; `portfolio` already
  // arrives sorted by value, and grouping preserves that order.
  const byType = React.useMemo(() => {
    const out = new Map<string, LivePayload["portfolio"]>();
    for (const p of payload.portfolio) {
      if (p.value <= 0) continue;
      const arr = out.get(p.type);
      if (arr) arr.push(p);
      else out.set(p.type, [p]);
    }
    return out;
  }, [payload.portfolio]);

  // Which slice the centre of the donut is currently reporting on. Set by the chart's own
  // focus when you point at an arc, and by the legend when you point at a row — one piece
  // of state either way, so the two always agree about what is highlighted.
  const [active, setActive] = React.useState<string | null>(null);

  const slice = active ? rows.find((r) => r.type === active) ?? null : null;
  const held = active ? byType.get(active) ?? [] : [];

  const definition = React.useMemo(() => {
    const slices = pie(rows, { value: (r) => r.value });
    return defineChart({
      marks: [
        polar({
          marks: [
            radialArc(slices, {
              key: (s) => s.type,
              // A ring, not a wheel: the hole is where the total lives.
              innerRadius: ({ radius }) => Math.max(0, radius - RING),
              outerRadius: ({ radius }) => radius,
              // Dimming the rest is how one slice steps forward without moving. Mixed
              // toward the card rather than given an opacity so the ring keeps one flat
              // silhouette instead of showing the panel through its quiet arcs.
              fill: (s) =>
                active && active !== s.type
                  ? `color-mix(in srgb, ${s.color} 25%, var(--card))`
                  : s.color,
            }),
          ],
        }),
      ],
      // A donut has no cartesian axes to draw and no scales to draw them from.
      guides: false,
      x: null,
      y: null,
      theme: CHART_THEME,
      // Arcs sweep to their new angles instead of jumping, which is the whole reason a
      // price tick is worth watching here: the ring is the one panel where you can see a
      // holding gaining on another. Reconciled by `key` above, so an arc keeps its identity
      // as the order changes — without it a slice that changed rank would swap fills with
      // its neighbour mid-tween.
      svgAnimation: CHART_MOTION,
      focusRing: false,
      tooltip: {
        use: tooltip,
        // Escapes the chart box. Unportalled the card is confined to the scene rectangle —
        // 172px square here — so it would be squeezed onto the ring however it were
        // anchored. Portalled, its only boundary is the viewport.
        portal,
        // Pinned to the ring's edge rather than to the pointer. A holdings list is taller
        // than the donut is wide, so a card following the cursor would sit on top of the
        // very slice being pointed at; from the side it clears the ring entirely, and it
        // stops sliding around while you sweep a single slice.
        anchor: (_points, { plot }) => ({ x: plot.x + plot.width, y: plot.y + plot.height / 2 }),
        placement: ["right", "left"],
        offset: 14,
        content: (points) => {
          const s = points[0]?.datum;
          if (!s) return { rows: [] };
          const inside = byType.get(s.type) ?? [];
          const extra = inside.length - SLICE_TIP_ROWS;
          return {
            title: `${s.type} · ${fmtMilVND(s.value)}`,
            rows: [
              ...inside.slice(0, SLICE_TIP_ROWS).map((h) => ({
                label: h.name,
                // Share of *this slice*, not of the portfolio — the parts add to 100%.
                value: `${fmtMilVND(h.value)} · ${((h.value / (s.value || 1)) * 100).toFixed(1)}%`,
              })),
              ...(extra > 0
                ? [{ label: `+${extra} smaller holding${extra === 1 ? "" : "s"}`, value: "" }]
                : []),
            ],
          };
        },
      },
    });
  }, [rows, byType, active]);

  return (
    <div className="relative flex h-full flex-col card-surface panel-body">
      <PanelHead
        title="Allocation"
        info="Current value by asset type, across all years. Hover a slice for the holdings inside it."
        className="mb-5"
      />
      <div className="relative mb-[22px] flex justify-center">
        <Chart
          definition={definition}
          width={SIZE}
          height={SIZE}
          style={CHART_HOST_STYLE}
          ariaLabel="Portfolio allocation by asset type"
          onFocusChange={(point) => setActive(point?.datum.type ?? null)}
        />
        {/* The hole's contents are ordinary text, laid over the chart rather than drawn
            into it: it reports on whatever is active, including the legend's hover, and
            nothing about it is chart geometry. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span data-unmask className="font-mono text-caption tracking-[0.08em] text-faint">
            {(slice?.type ?? "Total").toUpperCase()}
          </span>
          <span className="font-mono text-body tabular-nums">
            {fmtMilVND(slice ? slice.value : total)}
          </span>
          {slice && (
            <span className="font-mono text-caption tabular-nums text-faint">
              {slice.pct.toFixed(1)}% · {held.length} holding{held.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col">
        {/* Buttons, not rows: the legend is the touch way into the same highlight the arcs
            give a mouse. The holdings breakdown itself now lives in the chart's own
            tooltip, which its arrow-key navigation reaches too. */}
        {rows.map((r, i) => (
          <button
            key={r.type}
            type="button"
            className={cn(
              "flex w-full items-center justify-between py-[9px] text-left transition-opacity",
              i < rows.length - 1 && "border-b border-divider",
              active && active !== r.type && "opacity-45",
            )}
            onMouseEnter={() => setActive(r.type)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(r.type)}
            onBlur={() => setActive(null)}
          >
            <span className="flex items-center gap-2.5">
              <span className="size-[9px] rounded-[2px]" style={{ background: r.color }} />
              <span className="text-body-sm">{r.type}</span>
            </span>
            <span className="flex gap-3.5">
              <span className="font-mono text-caption text-muted-foreground tabular-nums">{fmtMilVND(r.value)}</span>
              <span className="w-[42px] text-right font-mono text-caption tabular-nums">{r.pct.toFixed(1)}%</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** A pager arrow, shaped like the rail's collapse button: a bordered square that goes quiet
 *  rather than disappearing when there's nowhere to go. */
function PagerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full bg-pane text-foreground transition-colors hover:bg-pane-2 disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/**
 * The design's Holdings panel: one row per position — the type-tinted mark, the name over
 * its asset type, a small value spark, and the money on the right.
 *
 * This was two panels, a bar chart of position values and a diverging bar chart of P&L.
 * They were the same ten holdings ranked two ways, and reading one against the other meant
 * matching names across half a page. A row carries both figures side by side, which is the
 * comparison you actually wanted, and it's the shape the design uses.
 */
export function HoldingsListCard({
  payload,
  holdingSeries,
}: {
  payload: LivePayload;
  holdingSeries: HoldingPnlPoint[] | null;
}) {
  const [query, setQuery] = React.useState("");
  const [type, setType] = React.useState<string>(ALL_TYPES);
  const [page, setPage] = React.useState(0);

  const held = React.useMemo(
    () =>
      payload.portfolio
        .filter((p) => p.value > 0 || p.pnl !== 0)
        .slice()
        .sort((a, b) => b.value - a.value),
    [payload.portfolio],
  );

  /** Only the types actually held — a filter offering "Crypto" to someone holding none is
   *  a dead end you have to try before you learn it's empty. */
  const types = React.useMemo(
    () => Array.from(new Set(held.map((h) => h.type))).sort(),
    [held],
  );

  const rows = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return held.filter(
      (h) =>
        (type === ALL_TYPES || h.type === type) &&
        (needle === "" || h.name.toLowerCase().includes(needle)),
    );
  }, [held, query, type]);

  // Paged, at a fixed four rows. This was a "Show all 10" toggle, which grew the panel by
  // six rows in place — and since it shares a row with Allocation and sits above the P&L
  // calendar, everything below it jumped. Paging keeps the panel one size whatever you're
  // looking at.
  //
  // The page is *clamped* rather than reset in an effect: filtering down to two holdings
  // while parked on page 3 has to land somewhere valid, and the React Compiler's
  // `set-state-in-effect` rule rightly refuses the useEffect version. The handlers below
  // still send you back to page 1 on a new search, which is the intent — this is the guard.
  const pageCount = Math.max(1, Math.ceil(rows.length / HOLDINGS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = rows.slice(safePage * HOLDINGS_PAGE_SIZE, (safePage + 1) * HOLDINGS_PAGE_SIZE);

  // Per-holding value history, keyed by name, for the row sparks. Built once for all rows
  // rather than re-scanned per row — the series is one pass over every day either way.
  const sparks = React.useMemo(() => {
    const out = new Map<string, number[]>();
    if (!holdingSeries) return out;
    for (const day of holdingSeries) {
      for (const h of day.holdings) {
        const arr = out.get(h.name);
        if (arr) arr.push(h.value);
        else out.set(h.name, [h.value]);
      }
    }
    return out;
  }, [holdingSeries]);

  if (held.length === 0) {
    return (
      // `h-full` so it sits level with Allocation beside it — that card stretches, and a
      // pair of panels sharing a row with mismatched bottoms reads as a mistake.
      <div className="h-full card-surface panel-body">
        <PanelHead title="Top holdings" />
        <p className="py-8 text-center text-body-sm text-muted-foreground">
          No holdings with a value yet — set live quantities or holding values to see them here.
        </p>
      </div>
    );
  }

  return (
    // `flex flex-col` + `h-full`: the card takes the row's height (so it and Allocation are
    // always the same height), and the pager below is pushed to its bottom edge with
    // `mt-auto` rather than floating under a short page.
    <div className="flex h-full flex-col card-surface panel-body">
      <PanelHead
        title="Top holdings"
        info="Every position with a value or a realised move, largest first — four at a time. The full list, grouped by asset type, is below. The spark is that holding's own value history; the second figure is its total gain or loss against cost."
        className="mb-3"
      />

      {/* The design's control row: a search field that takes the width, and a filter beside
          it. The filter is a real <Select> over the types actually held rather than the
          design's placeholder button. */}
      <div className="mb-1 flex gap-2.5">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-pane px-3.5 focus-within:ring-2 focus-within:ring-ring">
          <Search className="size-3.5 shrink-0 text-faint" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="Search"
            aria-label="Search holdings"
            className="min-w-0 flex-1 bg-transparent text-caption outline-none placeholder:text-faint"
          />
        </label>
        <Select value={type} onValueChange={(v) => { if (v != null) { setType(v); setPage(0); } }}>
          <SelectTrigger
            size="sm"
            aria-label="Filter by asset type"
            className="h-10 shrink-0 rounded-full border-transparent bg-pane pl-3.5 text-body-sm font-semibold hover:border-transparent hover:bg-pane-2"
          >
            <SelectValue>{type === ALL_TYPES ? "All" : type}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>All types</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Reserved to a full page's worth of rows, so a last page of one — or a search that
          matches nothing — doesn't pull the panel's bottom up and shift the calendar below. */}
      <div
        className="flex flex-col"
        style={{ minHeight: HOLDINGS_PAGE_SIZE * HOLDINGS_ROW_PX }}
      >
        {visible.length === 0 && (
          <p className="py-6 text-center text-caption text-muted-foreground">
            No holding matches that.
          </p>
        )}
        {visible.map((h) => {
          // A percentage only means something against real money still in the position.
          const pct = h.cost > 0 ? (h.pnl / h.cost) * 100 : null;
          const neg = h.pnl < 0;
          const paths = sparkPaths(sparks.get(h.name) ?? []);
          return (
            <div key={h.name} className="flex items-center gap-3 border-t border-divider py-3 first:border-t-0">
              <EntityAvatar name={h.name} color={typeColor(h.type)} logo={h.logo} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-body-sm font-semibold" title={h.name}>{h.name}</div>
                <div className="truncate text-caption text-faint">{h.type}</div>
              </div>
              {paths && (
                <svg
                  aria-hidden
                  viewBox="0 0 1000 300"
                  preserveAspectRatio="none"
                  className={cn("h-6 w-[58px] shrink-0", neg ? "text-destructive" : "text-accent-brand")}
                >
                  <path d={paths.line} fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
                </svg>
              )}
              <div className="shrink-0 text-right">
                <div className="font-mono text-caption tabular-nums">{fmtMilVND(h.value)}</div>
                {h.pnl !== 0 && (
                  <div className={cn("font-mono text-caption tabular-nums", neg ? "text-destructive" : "text-accent-brand")}>
                    {neg ? "↘ " : "↗ "}
                    {pct != null ? `${Math.abs(pct).toFixed(1)}%` : fmtSigned(h.pnl)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Always drawn, even on a single page — a control that comes and goes as you type
          would resize the panel, which is the thing paging is here to stop. The arrows just
          go dead instead. */}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-divider pt-3">
        <span data-unmask className="font-mono text-caption text-faint tabular-nums">
          {rows.length} holding{rows.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-1.5">
          <PagerButton
            label="Previous holdings"
            disabled={safePage === 0}
            onClick={() => setPage(safePage - 1)}
          >
            <ChevronLeft className="size-3.5" />
          </PagerButton>
          <span data-unmask className="min-w-[38px] text-center font-mono text-caption text-muted-foreground tabular-nums">
            {safePage + 1} / {pageCount}
          </span>
          <PagerButton
            label="More holdings"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage(safePage + 1)}
          >
            <ChevronRight className="size-3.5" />
          </PagerButton>
        </div>
      </div>
    </div>
  );
}
