"use client";

import * as React from "react";
import type { CSSProperties } from "react";
import type { ChartTheme, ChartValue } from "@tanstack/charts";

/**
 * What every chart here paints its furniture with.
 *
 * TanStack Charts defaults all four tokens to `currentColor`, which is right for a library
 * and wrong for us: inheriting the paragraph colour makes an axis as loud as the sentence
 * above it. Naming the app's own variables instead means Daylight and Midnight are handled
 * by the same CSS the rest of the UI uses, with no JS theme switch to keep in step.
 *
 * `grid` is `--foreground` and not `--border` because the library paints grid rules at a
 * fixed 11% opacity — a token that is already nearly the background would disappear
 * entirely at that strength. `background` is the card, so a focus ring reads as a hole
 * punched through the mark rather than a white dot floating over it.
 */
export const CHART_THEME: Partial<ChartTheme> = {
  foreground: "var(--foreground)",
  muted: "var(--muted-foreground)",
  grid: "var(--foreground)",
  background: "var(--card)",
};

/**
 * How every chart here moves when its data changes.
 *
 * The controls on these panels all change what a chart *is* — the metric, the bucket, the
 * window, the month, the holdings you've filtered to — and without this each one swapped
 * one picture for another between frames. Tweening the geometry is what makes those the
 * same chart moving rather than a series of unrelated ones: switching Weekly to Monthly
 * reads as the line settling, and a price tick nudges a bar rather than replacing it.
 *
 * 260ms because these are all small, dense panels where a slower tween starts to feel like
 * latency; it is quick enough to read as a response to the click that caused it.
 *
 * A tween rather than the `motion()` renderer, which is the other option the library
 * offers. Motion buys springs, entrance choreography and a crosshair that keeps its
 * velocity while focus retargets; it also pulls a browser motion runtime into every bundle
 * that draws a chart. Nothing on these panels is a physical object, so the tween is the
 * honest amount of animation for them.
 *
 * Two defaults are load-bearing and deliberately left alone. `respectReducedMotion` is on,
 * so a reader who asked the OS for less motion gets none of this. `resize` is off, so
 * dragging the window doesn't restart the tween on every layout pass — a chart reflows
 * instantly while it is being resized, which is what you want when it is chasing a column
 * width.
 *
 * What it animates is narrower than it sounds, and worth knowing before adding it to a
 * chart and assuming the chart now moves. Measured on these panels:
 *
 * - **Values move, geometry interpolates.** A price tick that changes today's figure walks
 *   the curve's last point up over the duration, and the donut's arcs sweep to their new
 *   angles. Bars are the same: isolating one series from a legend re-stacks the columns and
 *   rescales the axis, and every segment slides.
 * - **The sample set changes, the new picture is installed as it is.** Pick a different
 *   date window and the path has a different number of commands, so there is no skeleton to
 *   interpolate against and the library swaps it — verified: the new geometry is on screen
 *   within 40ms of the click. Only when the mark *set* changes does the fallback show, and
 *   that is a crossfade rather than a slide.
 * - **A colour written as `var(--x)` cannot interpolate**, which is most of ours.
 *
 * So this is worth adding where a chart's numbers move under a stable set of marks, and not
 * worth pretending about anywhere else. Keys are what decide "same mark, new value" from
 * "different mark", so a mark whose identity isn't its x value carries an explicit `key`.
 */
export const CHART_MOTION = { duration: 260, easing: "ease-out" } as const;

/**
 * The built-in tooltip is a real DOM element the chart host owns, styled from
 * `--ts-chart-tooltip-*` custom properties that each fall back to a browser default.
 * Setting them on the chart host — which the tooltip is always a descendant of, portalled
 * or not — is how the native surface takes on our popover look without a stylesheet
 * override or an `!important`.
 */
export const CHART_HOST_STYLE = {
  "--ts-chart-tooltip-background": "var(--background)",
  "--ts-chart-tooltip-color": "var(--foreground)",
  "--ts-chart-tooltip-border": "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
  "--ts-chart-tooltip-border-radius": "var(--radius-lg, 0.5rem)",
  "--ts-chart-tooltip-padding": "0.375rem 0.625rem",
  "--ts-chart-tooltip-shadow": "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
  "--ts-chart-tooltip-font": "500 0.75rem/1.3 var(--font-sans), sans-serif",
  // The default caps the card at 80% of the *chart's* width, which is fine for a wide
  // series and ruinous for a 172px donut — every holding name there wraps to one letter a
  // line. The card is fixed-positioned, so it is free to be wider than the chart it
  // belongs to; the viewport is the only edge it actually has to respect.
  "--ts-chart-tooltip-max-width": "min(20rem, 90vw)",
} as CSSProperties;

/**
 * Axis presentation shared by every chart on the site: no axis rule, no tick stubs, just
 * labels. Tick labels are forced back to full `opacity` because the library dims them to
 * 0.68 by default, which lands as a second dimming on top of `--muted-foreground`.
 *
 * `minGap` is the pixel breathing room between two labels before one of them is dropped —
 * the knob that keeps a daily series from printing 300 dates on top of each other.
 */
export function bareAxis<TValue extends ChartValue>(options?: {
  format?: (value: TValue) => string;
  minGap?: number;
}) {
  return {
    line: false,
    ticks: { size: 0, format: options?.format },
    tickLabels: {
      opacity: 1,
      thin: options?.minGap === undefined ? true : { minGap: options.minGap },
    },
  };
}

/** Put this on the chart host to opt its interactive legend into the chip look below. */
export const CHIP_LEGEND_CLASS = "legend-chips";

/**
 * The chip look for `interactiveColorLegend`, as a stylesheet.
 *
 * The legend is the library's control — pressed state, keyboard order, aria wiring and the
 * column layout all come with it — but its chrome does not go through the theme: the buttons
 * are built in JS with their paint written as inline styles, and there is no
 * `--ts-chart-legend-*` family to answer the way `--ts-chart-tooltip-*` does for the tooltip.
 * A stylesheet is therefore the only handle on it, and `!important` the only way past an
 * inline style. What we're overriding is presentation alone; every declaration below has a
 * counterpart the library wrote inline.
 *
 * The default is a row of 44px pills in bold system-ui, filled grey whenever a series is on —
 * which is *always*, until you isolate one. So the resting state looked pressed, the chips
 * shouted next to 12.5px labels everywhere else on the page, and nothing said which series you
 * had singled out. These are the donut's legend rows instead (`dashboard-charts.tsx`): a 9px
 * square in the series colour, the name at reading size, and the ones you aren't looking at
 * dropped to a whisper.
 *
 * `:has()` is what tells "everything is on" apart from "this one is isolated" — the library
 * marks both with `data-visible="true"`, so a chip only earns the selected look while some
 * sibling is off.
 *
 * The grid becomes a centred wrap so a chip is as wide as its name rather than as wide as its
 * share of the panel, which is what left the last row hanging off to the left. It stays inside
 * the height the library reserved because no chip may exceed the width the column maths was
 * told to assume (`--legend-chip`): wrapping at that width can only fit *more* per row than a
 * grid of equal columns, never fewer.
 */
const LEGEND_CSS = `
.${CHIP_LEGEND_CLASS} .ts-chart__interactive-legend {
  display: flex !important;
  flex-wrap: wrap;
  align-content: center;
  justify-content: center;
}
.${CHIP_LEGEND_CLASS} .ts-chart__interactive-legend button {
  max-width: var(--legend-chip);
  min-height: 28px !important;
  padding: 4px 10px 4px 8px !important;
  gap: 6px !important;
  border-color: var(--border) !important;
  background: transparent !important;
  color: var(--muted-foreground) !important;
  font: 500 12.5px/1.1 var(--font-sans), sans-serif !important;
  text-decoration: none !important;
  transition: color .15s, background-color .15s, border-color .15s, opacity .15s;
}
.${CHIP_LEGEND_CLASS} .ts-chart__interactive-legend button:hover {
  border-color: var(--input) !important;
  background: var(--pane) !important;
  color: var(--foreground) !important;
}
.${CHIP_LEGEND_CLASS} .ts-chart__interactive-legend button:focus-visible {
  outline: 2px solid var(--ring) !important;
  outline-offset: 2px !important;
}
.${CHIP_LEGEND_CLASS} .ts-chart__interactive-legend [data-chart-legend-swatch] {
  width: 9px !important;
  height: 9px !important;
  border-radius: 2px !important;
  border-width: 1.5px !important;
}
.${CHIP_LEGEND_CLASS} .ts-chart__interactive-legend [data-chart-legend-label] {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${CHIP_LEGEND_CLASS} .ts-chart__interactive-legend:has(button[data-visible="false"]) button[data-visible="true"] {
  border-color: var(--input) !important;
  background: var(--pane) !important;
  color: var(--foreground) !important;
  font-weight: 600 !important;
}
.${CHIP_LEGEND_CLASS} .ts-chart__interactive-legend button[data-visible="false"] {
  border-color: transparent !important;
  opacity: 0.5;
}
.${CHIP_LEGEND_CLASS} .ts-chart__interactive-legend button[data-visible="false"]:hover {
  opacity: 1;
}
.${CHIP_LEGEND_CLASS} .ts-chart__interactive-legend button[data-visible="false"] [data-chart-legend-swatch] {
  background: transparent !important;
}
/* A chip sized for a pointer is a poor target for a thumb, and the row the library reserves
   is 44px tall either way — so the extra height is free where it's needed. */
@media (max-width: 640px) {
  .${CHIP_LEGEND_CLASS} .ts-chart__interactive-legend button {
    min-height: 34px !important;
    padding: 7px 12px 7px 10px !important;
  }
}
`;

/**
 * Mount once per panel that uses a chip legend.
 *
 * React escapes the text children of a `<style>`, which would turn the quotes in the attribute
 * selectors into entities; the `precedence` prop is what hoists it into the head exactly once,
 * however many panels ask for it.
 */
export function ChipLegendStyle() {
  return (
    <style
      href="netlens-chart-legend"
      precedence="default"
      dangerouslySetInnerHTML={{ __html: LEGEND_CSS }}
    />
  );
}

/** The width to draw at before anything has been measured — a desktop panel, since that is
 *  what the server renders into and a phone corrects on its first frame. */
export const INITIAL_PANEL_WIDTH = 900;

/**
 * The width the library is told a chip wants, which is what its column count — and so the
 * band it reserves — comes out of.
 *
 * It has to track what a chip *actually* measures, because the CSS below wraps them as flex
 * items while the library reserves rows for a grid of this width. Tell it 128 on a phone and
 * it takes one column, reserves a row per series, and leaves six rows of nothing under three
 * rows of chips. These numbers are close to what a name renders at, so the reservation and
 * the wrap agree; anything longer truncates against `--legend-chip` instead of buying a row.
 */
export function legendItemWidth(width: number): number {
  return width < 520 ? 76 : width < 820 ? 96 : 104;
}

/** …but past a point a wide chip is just a long pill with a short word in it. */
const LEGEND_ITEM_MAX = 240;

/** The legend's own geometry, which the library keeps to itself: a fixed 44px per row, an 8px
 *  gutter between rows and columns, and 6px of padding above and below. Mirrored here so a
 *  panel can size itself around the legend instead of into it — see `legendChartMetrics`.
 *  Verified against `dist/interactive-legend.js` (`controlItemHeight` / `controlGap` /
 *  `controlPadding`), whose own height formula this reproduces exactly. */
const LEGEND_ROW = 44;
const LEGEND_GAP = 8;
const LEGEND_PAD = 6;

/** Roughly what the y-axis labels take off the left edge. Deliberately generous: the column
 *  count is a step function of this, and guessing the gutter *narrow* is what makes the
 *  prediction claim two columns where the library takes one — half the rows, half the band,
 *  and a plot squashed to a strip. Guessing it wide only reserves a row that goes unused for
 *  the one frame before the real height is measured. */
const AXIS_GUTTER = 64;

/**
 * How tall a chart with an inside legend has to be to hold both, and how wide a chip may be
 * inside it.
 *
 * The library reserves its legend out of the chart's height, so at phone width a dozen series
 * — six rows of them — reserved more than the entire chart and left the marks with nothing to
 * stand in. Deriving the height instead means the legend is paid for by the panel: the plot
 * keeps the shape it wants at every width, and extra series push the card down the page rather
 * than flattening the thing they're a key to.
 *
 * `chip` is the widest a name may be drawn before it truncates, and it is the whole of the
 * promise the wrapped layout makes to the reserved height: hand the row as many chips as the
 * reserved rows have to hold and no more, and the wrap can only come out shorter than the
 * grid. Four series on a wide panel get a fifth of it each and their names in full; a dozen
 * share the same row, and the long ones give way to an ellipsis.
 *
 * The plot's own proportions shift with width because a phone is not a wide screen with less
 * in it: twelve stacked columns in a 3:1 strip would be 90px tall there. `aspect` overrides
 * that curve for a chart that needs a taller plot than the default.
 */
export function legendChartMetrics(
  count: number,
  width: number,
  band: number | null,
  aspect: (w: number) => number = (w) => (w < 520 ? 1.7 : w < 820 ? 2.5 : 3.2),
): { height: number; chip: number } {
  // A floor rather than the raw measurement, so a panel that is briefly zero-width — laid out
  // inside a closed disclosure, say — asks for one sane row instead of one per series.
  const plot = Math.max(160, width - AXIS_GUTTER);
  // The measured band when there is one; the library's own arithmetic on a pessimistic plot
  // width until then.
  const legend = band ?? predictedLegendBand(count, plot, legendItemWidth(width));
  const rows = Math.max(1, Math.round((legend - LEGEND_PAD * 2 + LEGEND_GAP) / (LEGEND_ROW + LEGEND_GAP)));
  return {
    height: Math.round(width / aspect(width)) + legend,
    chip: Math.min(LEGEND_ITEM_MAX, Math.floor((plot + LEGEND_GAP) / Math.ceil(count / rows)) - LEGEND_GAP),
  };
}

/** `layoutCategoricalLegendItems` + `height()` from `dist/interactive-legend.js`, reproduced
 *  for the first paint only — see `useLegendBand` for why it isn't trusted after that. */
function predictedLegendBand(count: number, plot: number, itemWidth: number): number {
  const columns = Math.max(
    1,
    Math.min(count, Math.floor((plot + LEGEND_GAP) / (itemWidth + LEGEND_GAP)) || 1),
  );
  const rows = Math.ceil(count / columns);
  return LEGEND_PAD * 2 + rows * LEGEND_ROW + (rows - 1) * LEGEND_GAP;
}

/**
 * The height the library actually reserved for the legend, measured rather than predicted.
 *
 * Predicting it means reproducing `columns = floor(plotWidth / itemWidth)`, and that is a step
 * function of a plot width we can only estimate — the axis gutter depends on how long the tick
 * labels happen to be. Land a few pixels the wrong side of a boundary and the guess claims two
 * columns where the library takes one: half the rows, half the band, and a plot squeezed into
 * whatever is left. It did exactly that at 390px.
 *
 * Measuring is stable because the band's height depends only on the width and the number of
 * series — never on the height we hand back — so feeding it into that height cannot oscillate.
 */
export function useLegendBand(): [number | null, (node: HTMLDivElement | null) => void] {
  const [band, setBand] = React.useState<number | null>(null);
  const ref = React.useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    let resize: ResizeObserver | undefined;
    const watch = () => {
      const el = node.querySelector<HTMLElement>(".ts-chart__interactive-legend");
      if (!el) return false;
      resize = new ResizeObserver(([entry]) => setBand(entry.contentRect.height));
      resize.observe(el);
      return true;
    };
    // The legend is built by the chart after mount, so it is usually not there on the first
    // call — wait for it rather than giving up and keeping the prediction forever.
    if (watch()) return () => resize?.disconnect();
    const appear = new MutationObserver(() => {
      if (watch()) appear.disconnect();
    });
    appear.observe(node, { childList: true, subtree: true });
    return () => {
      appear.disconnect();
      resize?.disconnect();
    };
  }, []);
  return [band, ref];
}

/**
 * The panel's own width, which the legend's row count — and so the height the panel needs —
 * follows. Seeded with the same guess the chart itself starts from, so the two agree on the
 * first paint and on every one after it.
 */
export function usePanelWidth(initial: number): [number, (node: HTMLDivElement | null) => void] {
  const [width, setWidth] = React.useState(initial);
  const measure = React.useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [width, measure];
}
