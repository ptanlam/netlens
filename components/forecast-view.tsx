"use client";

import * as React from "react";
import { areaY, defineChart, differenceY, lineY } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { scaleUtc } from "d3-scale";
import { fmtMil, fmtVND, MONTHS } from "@/lib/format";
import { applyGrowth, type ForecastEvent, type ForecastEventKind, type ForecastPoint, type GrownPoint } from "@/lib/forecast";
import type { BarSource } from "@/lib/score";
import { MIN_MONTHS, PATHS, simulateBand, type PortfolioReturns } from "@/lib/volatility";
import { PageHeader } from "@/components/page-header";
import { PanelHead } from "@/components/panel-head";
import { SummaryCards } from "@/components/stat-card";
import { bareAxis, CHART_HOST_STYLE, CHART_MOTION, CHART_THEME } from "@/components/ui/chart";
import { cn } from "@/lib/utils";

/** The horizons the picker offers. Five years is the cap: past it every deposit has matured
 *  and every loan cleared, so the line is the pace extrapolated and nothing else. */
const HORIZONS = [12, 24, 36, 60] as const;

/**
 * The assumed annual return on investments, in %/yr.
 *
 * **0 is the default and it is not a placeholder** — it is the reading the rest of the app
 * is built on (`lib/goals.ts`, `lib/score.ts`), and everything above it is the reader's own
 * assumption rather than the app's. Picking a house rate here would put a number nobody
 * agreed to underneath every figure on the page.
 *
 * A negative option, first, and deliberately: a forecast that can only bend upward is a
 * sales pitch. "What if it goes badly" is the half of the question worth asking, so it can't
 * be the option you have to go looking for.
 */
const RATES = [-5, 0, 5, 8, 12] as const;

/** Where the assumed pace came from, said plainly. The forecast never quotes a number
 *  without saying who committed to it. */
const PACE_LABEL: Record<BarSource, string> = {
  recurring: "From your recurring rules",
  goals: "From your goals' monthly plans",
  none: "No commitment set",
};

const KIND_LABEL: Record<ForecastEventKind, string> = {
  maturity: "Deposit matures",
  payoff: "Debt cleared",
  goal: "Goal date",
  renewal: "Annual renewal",
};

/** Each event is tinted with the hue of the page it came from — the same five-slot palette
 *  the nav tints its sections with, and the streak its levers. */
const KIND_COLOR: Record<ForecastEventKind, string> = {
  maturity: "var(--color-hue-green)",
  payoff: "var(--color-hue-amber)",
  goal: "var(--color-hue-violet)",
  renewal: "var(--color-hue-amber)",
};

/** "2027-03-14" → "Mar 2027". */
function fmtMonth(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** "2027-03-14" → "14 Mar". */
function fmtDay(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

interface Point extends GrownPoint {
  /** The month as a `Date`, because the x axis is a real time scale. */
  at: Date;
  label: string;
  /** Set only in historical mode — the bootstrapped band's percentiles. */
  p10?: number;
  p50?: number;
  p90?: number;
}

function tip(datum: unknown) {
  const p = datum as Point | undefined;
  if (!p || typeof p.net !== "number") return { rows: [] };
  const rows = [
    { label: "Net worth", value: fmtVND(p.grown), color: "var(--chart-ink)" },
    { label: "Locked in", value: fmtVND(p.floor), color: "var(--chart-gold)" },
  ];
  // Named by where a path landed, not "best/worst case": a tenth of paths still fell outside.
  if (p.p10 !== undefined && p.p50 !== undefined && p.p90 !== undefined)
    rows.push(
      { label: "Top 10% of paths", value: fmtVND(p.p90), color: "var(--color-hue-violet)" },
      { label: "Median path", value: fmtVND(p.p50), color: "var(--color-hue-violet)" },
      { label: "Bottom 10% of paths", value: fmtVND(p.p10), color: "var(--color-hue-violet)" },
    );
  if (p.contributed > 0)
    rows.push({ label: "You add", value: fmtVND(p.contributed), color: "var(--chart-positive)" });
  // Named "assumed", never "growth" or "gains": it is the only row here that isn't derived
  // from something already written down.
  if (p.growth !== 0)
    rows.push({
      label: "Assumed return",
      value: `${p.growth < 0 ? "−" : "+"}${fmtVND(Math.abs(p.growth))}`,
      color: p.growth < 0 ? "var(--chart-negative)" : "var(--chart-positive)",
    });
  rows.push({ label: "Savings", value: fmtVND(p.savings), color: "var(--color-hue-green)" });
  if (p.debts > 0)
    rows.push({ label: "Owed", value: `−${fmtVND(p.debts)}`, color: "var(--chart-negative)" });
  return { title: p.label, rows };
}

/**
 * Net worth, projected forward from what you've already committed to.
 *
 * The walk arrives finished from the server and is never re-projected here. The dashboard
 * ships a whole `GoalWorld` to the client so a price tick can move its goals without a round
 * trip; this page doesn't, because that channel is fed by `/api/pnl-history` — the most
 * expensive read in the app — and nothing here draws the series. A price refresh still
 * reaches it the ordinary way, through the `router.refresh()` in `useRefreshPrices`, which
 * re-renders the tree server-side exactly as it does for /investments and /goals.
 *
 * Which is enough at this resolution: the curve is monthly and runs for years, so a quote
 * moving the first point by a hair would redraw all of it to say nothing.
 */
export function ForecastView({
  points,
  events,
  pace,
  paceSource,
  today,
  portfolioReturns,
}: {
  /** The full 60-month walk. The picker slices it rather than asking for another one — the
   *  maths is pure and the payload is a few dozen rows either way. */
  points: ForecastPoint[];
  events: ForecastEvent[];
  pace: number;
  paceSource: BarSource;
  today: string;
  portfolioReturns: PortfolioReturns;
}) {
  const [horizon, setHorizon] = React.useState<number>(24);
  // Opt-in every visit, and never remembered. A rate left switched on from last week would
  // quietly become the number you think the app is telling you.
  const [rate, setRate] = React.useState<number>(0);
  // Mutually exclusive with the rate: one assumption on screen at a time.
  const [mode, setMode] = React.useState<"rate" | "historical">("rate");
  const canBand = portfolioReturns.coverage > 0;
  const historical = mode === "historical" && canBand;
  const effectiveRate = historical ? 0 : rate;

  const shown = React.useMemo(
    () => applyGrowth(points.slice(0, horizon + 1), pace, effectiveRate),
    [points, horizon, pace, effectiveRate],
  );
  const band = React.useMemo(
    () => (historical ? simulateBand(points.slice(0, horizon + 1), pace, portfolioReturns) : null),
    [historical, points, horizon, pace, portfolioReturns],
  );
  const pts = React.useMemo<Point[]>(
    () =>
      shown.map((p, i) => ({
        ...p,
        at: new Date(Date.parse(p.date + "T00:00:00Z")),
        label: fmtMonth(p.date),
        ...(band ? { p10: band[i].p10, p50: band[i].p50, p90: band[i].p90 } : {}),
      })),
    [shown, band],
  );

  const now = points[0];
  const end = shown[shown.length - 1];
  const horizonEvents = React.useMemo(
    () => events.filter((e) => e.date <= (end?.date ?? today)),
    [events, end, today],
  );

  // Grouped by month for the ledger. A plain loop rather than a reduce over a map: the
  // React Compiler's immutability rule forbids accumulating into a captured variable inside
  // a `.map()`, and this stays readable without working around it.
  const byMonth = React.useMemo(() => {
    const groups = new Map<string, ForecastEvent[]>();
    for (const e of horizonEvents) {
      const key = e.date.slice(0, 7);
      const list = groups.get(key);
      if (list) list.push(e);
      else groups.set(key, [e]);
    }
    return [...groups];
  }, [horizonEvents]);

  const definition = React.useMemo(
    () =>
      defineChart({
        marks: [
          crosshair({
            x: { stroke: "var(--foreground)", strokeOpacity: 0.4, strokeDasharray: "3 3" },
            y: false,
            marker: { radius: 4.5, stroke: "var(--card)", strokeWidth: 2 },
          }),
          // Everything under the contracted line: money you hold whatever you do next.
          areaY(pts, {
            x: "at",
            y1: 0,
            y2: "floor",
            fill: "var(--chart-gold)",
            fillOpacity: 0.09,
          }),
          // The gap between contracted and committed, drawn as a gap rather than as a
          // second slab: its height is exactly the part of the future that depends on you
          // keeping the pace, which is the one thing on this chart you can change.
          differenceY(pts, {
            x: "at",
            y1: "floor",
            y2: "net",
            positiveFill: "var(--chart-positive)",
            positiveFillOpacity: 0.2,
            negativeFill: "var(--chart-negative)",
            negativeFillOpacity: 0.18,
            stroke: "var(--chart-ink)",
            strokeWidth: 2,
            // Dashed, and the one on top: the contracted line is the promise, the solid ink
            // above it is the projection built on top of it.
            comparisonStroke: "var(--chart-gold)",
            comparisonStrokeWidth: 1.5,
            comparisonStrokeDasharray: "5 4",
          }),
          // The assumed return, as a third band above (or below) the solid line — never
          // folded into it. The solid ink line keeps meaning "money, at no assumed return",
          // so whatever a rate does to this chart you can still see the figure without it by
          // reading one line down. Dashed, because a dashed edge is what the rest of the app
          // uses for a number that isn't settled, and its comparison edge is suppressed —
          // the band below already draws that line.
          // The historical range: where 80% of bootstrapped paths landed, and the median.
          // Violet is this page's own nav tint — it isn't a gain or a loss, so it borrows
          // neither of those colours.
          ...(historical
            ? [
                areaY(pts, {
                  x: "at",
                  y1: "p10",
                  y2: "p90",
                  fill: "var(--color-hue-violet)",
                  fillOpacity: 0.16,
                }),
                lineY(pts, {
                  x: "at",
                  y: "p50",
                  stroke: "var(--color-hue-violet)",
                  strokeWidth: 2,
                  strokeDasharray: "4 3",
                }),
              ]
            : []),
          ...(effectiveRate !== 0
            ? [
                differenceY(pts, {
                  x: "at",
                  y1: "net",
                  y2: "grown",
                  positiveFill: "var(--chart-positive)",
                  positiveFillOpacity: 0.34,
                  negativeFill: "var(--chart-negative)",
                  negativeFillOpacity: 0.3,
                  stroke: "var(--chart-ink)",
                  strokeOpacity: 0.55,
                  strokeWidth: 1.5,
                  strokeDasharray: "4 3",
                  comparisonStrokeWidth: 0,
                  comparisonStrokeOpacity: 0,
                }),
              ]
            : []),
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
        tooltip: { use: tooltip, content: (focused) => tip(focused[0]?.datum) },
      }),
    [pts, effectiveRate, historical],
  );

  if (!now || !end) return null;

  const added = end.net - end.floor;
  const endBand = band?.[band.length - 1];
  const headline = endBand ? endBand.p50 : end.grown;
  const change = headline - now.net;
  const assumed = effectiveRate !== 0;
  const excludedShare = 1 - portfolioReturns.coverage;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Forecast">
        Where the decisions you&apos;ve already made leave you. Deposits accrue, loans amortise,
        and money you&apos;ve committed to saving keeps arriving —{" "}
        {historical ? (
          <>
            on top of which this page is showing{" "}
            <strong className="font-semibold">
              the range your current holdings&apos; own past returns would give
            </strong>
            . That&apos;s how volatile they have been, not a prediction of what they&apos;ll do.
          </>
        ) : assumed ? (
          <>
            on top of which this page is currently{" "}
            <strong className="font-semibold">assuming {rate}%/yr on investments</strong>, which is
            your assumption and nobody else&apos;s.
          </>
        ) : (
          <>
            <strong className="font-semibold">investments are assumed to return nothing</strong>, so
            this is a floor rather than a bet.
          </>
        )}
      </PageHeader>

      <SummaryCards
        stats={[
          { label: "Net worth today", value: fmtVND(now.net), sub: "The dashboard's figure" },
          {
            label: `In ${horizon} months`,
            value: fmtVND(headline),
            // With a rate on, the tile names both figures. Showing only the grown one would
            // let an assumption occupy the page's headline without saying so, and showing
            // only the flat one would make the dial look broken. The historical median gets
            // its spread for the same reason.
            sub: endBand
              ? `Median · 80% of paths ${fmtMil(endBand.p10)}–${fmtMil(endBand.p90)}`
              : assumed
                ? `${fmtVND(end.net)} at 0% · assumes ${rate}%/yr`
                : `${change >= 0 ? "+" : "−"}${fmtVND(Math.abs(change))} from today`,
            tone: change >= 0 ? "gain" : "loss",
          },
          {
            label: "Locked in",
            value: fmtVND(end.floor),
            sub: "If you add nothing more from today",
          },
          {
            label: assumed ? "Assumed return" : "You add",
            value: assumed ? fmtVND(end.growth) : pace > 0 ? fmtVND(added) : "—",
            sub: assumed
              ? `On what you hold and what you add, at ${rate}%/yr`
              : pace > 0
                ? `${fmtVND(pace)}/month · ${PACE_LABEL[paceSource]}`
                : PACE_LABEL.none,
            tone: assumed ? (end.growth >= 0 ? "gain" : "loss") : undefined,
          },
        ]}
      />

      <div className="card-surface panel-body">
        <PanelHead
          title="Net worth, projected"
          info={
            historical
              ? `Two lines as usual — what you hold adding nothing more (dashed gold), and the same plus your committed pace (solid) — plus a violet band: ${PATHS.toLocaleString("en-US")} simulated paths, each month drawing a return at random from what each holding actually did in a past month, weighted by today's mix. The band holds the middle 80% of paths; the dashed violet line is the median. Holdings move independently in the simulation, so it understates how much they fall together in a crash.`
              : assumed
              ? `Three bands: what you hold adding nothing more (dashed gold), the same plus the pace you've committed to (solid), and on top of that ${rate}%/yr assumed on investments. Only the top band is an assumption — read one line down to see the figure without it.`
              : "Two lines: what you hold if you add nothing more from today (dashed), and the same plus the monthly pace you've committed to (solid). Investments are held flat — no market return is assumed either way."
          }
          actions={
            <div className="flex gap-[3px] rounded-full border border-border bg-secondary p-[3px]">
              {HORIZONS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHorizon(h)}
                  className={cn(
                    "cursor-pointer rounded-full border-0 px-3 py-[5px] text-[12px] font-semibold transition-colors",
                    horizon === h
                      ? "bg-pane-2 text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {h === 60 ? "5Y" : `${h / 12}Y`}
                </button>
              ))}
            </div>
          }
        />
        {/* On its own row under the head, with a label, rather than as a second pill group
            beside the horizon: the horizon only chooses how much of a computed walk to show,
            while this one changes what the walk claims. Two controls of such different
            weight shouldn't sit side by side looking alike. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-[12px] text-muted-foreground">Investments</span>
          <div className="flex gap-[3px] rounded-full border border-border bg-secondary p-[3px]">
            {(
              [
                ["rate", "Fixed rate"],
                ["historical", "Historical range"],
              ] as const
            ).map(([m, label]) => {
              const disabled = m === "historical" && !canBand;
              return (
                <button
                  key={m}
                  type="button"
                  disabled={disabled}
                  onClick={() => setMode(m)}
                  title={
                    disabled
                      ? `No holding has ${MIN_MONTHS} months of price history yet — nothing to draw a range from.`
                      : undefined
                  }
                  className={cn(
                    "cursor-pointer rounded-full border-0 px-2.5 py-[5px] text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    (m === "historical") === historical
                      ? "bg-pane-2 text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {!historical && (
            <div className="flex gap-[3px] rounded-full border border-border bg-secondary p-[3px]">
              {RATES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRate(r)}
                  className={cn(
                    "cursor-pointer rounded-full border-0 px-2.5 py-[5px] font-mono text-[12px] font-semibold transition-colors",
                    rate === r
                      ? "bg-pane-2 text-foreground shadow-[0_1px_6px_rgb(0_0_0/0.18)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r > 0 ? `+${r}%` : `${r}%`}
                </button>
              ))}
            </div>
          )}
          <span className="text-[11.5px] text-faint">
            {historical
              ? "Everything in violet comes from your holdings' past — it's a spread, not a promise."
              : assumed
                ? "Everything above the solid line is this assumption — nothing else on the page uses it."
                : "Nothing is assumed. The rest of the app reads 0% too."}
          </span>
        </div>

        <div className="mt-3">
          <Chart
            definition={definition}
            height={260}
            initialWidth={1000}
            className="w-full"
            style={CHART_HOST_STYLE}
            ariaLabel="Net worth projected forward"
          />
        </div>
        {historical && portfolioReturns.excluded.length > 0 && (
          <p className="mt-2 text-[11.5px] text-faint">
            Held flat in the range, with under {MIN_MONTHS} months of price history to sample
            from: {portfolioReturns.excluded.map((e) => e.name).join(", ")} (
            {Math.round(excludedShare * 100)}% of your portfolio). They still count in the total
            — they just don&apos;t swing.
          </p>
        )}
        {/* The composition, at the far end of the window. A single line hides which half of
            it is a deposit maturing and which is a loan going away. */}
        <div
          className={cn(
            "mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-divider-soft pt-4 sm:grid-cols-3",
            assumed ? "lg:grid-cols-6" : "lg:grid-cols-5",
          )}
        >
          {/* The lines sum to the figure above, "You add" included — it is money that has to
              land somewhere, and giving it a column of its own is what stops the other four
              from having to pretend they know which pocket. The assumed return joins them as
              a column rather than being spread across the others, for the same reason it is
              its own band on the chart. */}
          {[
            { label: "Investments", now: now.investments, then: end.investments },
            { label: "Savings", now: now.savings, then: end.savings },
            { label: "Set aside", now: now.fundCash, then: end.fundCash },
            { label: "Owed", now: -now.debts, then: -end.debts },
            { label: "You add", now: 0, then: end.contributed },
            ...(assumed ? [{ label: `Assumed at ${rate}%`, now: 0, then: end.growth }] : []),
          ].map((row) => (
            <div key={row.label}>
              <div className="text-[12px] text-muted-foreground">{row.label}</div>
              <div className="mt-1 font-mono text-[14px] tabular-nums">{fmtVND(row.then)}</div>
              <div
                className={cn(
                  "mt-0.5 font-mono text-[11.5px] tabular-nums",
                  row.then - row.now >= 0 ? "text-accent-brand" : "text-(--chart-negative)",
                )}
              >
                {row.then - row.now >= 0 ? "+" : "−"}
                {fmtVND(Math.abs(row.then - row.now))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {pace === 0 && (
        <div className="rounded-xl border border-warning-border bg-warning-bg px-5 py-4 text-[13px]">
          <span className="font-semibold">Nothing committed, so nothing is projected.</span>{" "}
          <span className="text-muted-foreground">
            The line above is only what you already hold. Set a recurring rule, or a monthly plan
            on a goal, and the forecast has a pace to work from — the same bar the saving streak
            judges a month by.
          </span>
        </div>
      )}

      <div className="card-surface panel-body">
        <PanelHead
          title="What's already scheduled"
          info="Every dated event inside the window — the things that make the line change shape. A projection you can't interrogate is a decoration."
        />
        {byMonth.length === 0 ? (
          <p className="py-6 text-[13px] text-muted-foreground">
            Nothing scheduled in the next {horizon} months — no deposit matures, no debt clears
            and no goal falls due.
          </p>
        ) : (
          <div className="mt-3 flex flex-col">
            {byMonth.map(([month, list]) => (
              <div
                key={month}
                className="flex flex-col gap-2 border-t border-divider-soft py-3 first:border-t-0 sm:flex-row sm:gap-5"
              >
                <div className="shrink-0 pt-0.5 font-mono text-[12px] text-faint sm:w-[76px]">
                  {fmtMonth(`${month}-01`)}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {list.map((e, i) => (
                    <div key={`${e.date}:${e.label}:${i}`} className="flex items-baseline justify-between gap-3">
                      <div className="flex min-w-0 items-baseline gap-2.5">
                        <span
                          className="size-[9px] shrink-0 translate-y-[-1px] rounded-[2px]"
                          style={{ background: KIND_COLOR[e.kind] }}
                        />
                        <span className="truncate text-[13.5px]">{e.label}</span>
                        {/* The kind is spelled out from `sm` only. On a phone the row has
                            just enough width for the name and the amount, and the swatch
                            already says which kind it is. */}
                        <span className="shrink-0 text-[11.5px] text-faint">
                          {fmtDay(e.date)}
                          <span className="hidden sm:inline"> · {KIND_LABEL[e.kind]}</span>
                        </span>
                      </div>
                      {e.amount != null && (
                        <span
                          className={cn(
                            "shrink-0 font-mono text-[13px] tabular-nums",
                            e.outside && "text-faint",
                          )}
                        >
                          {fmtVND(e.amount)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {/* Renewals are listed but never drawn: a subscription is a rate of spend, neither a
            thing you own nor a debt you owe, and it stays out of net worth here for exactly
            the reason it stays out of it on the dashboard. */}
        {horizonEvents.some((e) => e.outside) && (
          <p className="mt-3 text-[11.5px] text-faint">
            Annual renewals are shown in grey — they land in that month, but subscriptions sit
            outside net worth, so they don&apos;t move the line above.
          </p>
        )}
      </div>
    </div>
  );
}
