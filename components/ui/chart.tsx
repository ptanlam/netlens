"use client";

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
