"use client";

import * as React from "react";
import { areaY, defineChart } from "@tanstack/charts";
import { focusDisabled } from "@tanstack/charts/focus/disabled";
import { brushX, type BrushRange, type BrushXChange } from "@tanstack/charts/interaction/brush";
import { controlledSignal } from "@tanstack/charts/interaction/signal";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";

import type { PnlPoint } from "@/lib/types";
import { CHART_THEME } from "@/components/ui/chart";

/** The window a brush has selected, or the whole span when it hasn't. */
export interface DateWindow {
  /** Every date in the series, in order — the brush's semantic steps. */
  dates: string[];
  /** The selected span. Null only when the series is empty. */
  range: BrushRange<string> | null;
  /** The rows inside that span — what the detail chart actually draws. */
  rows: PnlPoint[];
  setRange: (next: BrushRange<string> | null) => void;
  /** Whether the reader has narrowed the view, i.e. whether a reset means anything. */
  zoomed: boolean;
}

/**
 * A date window a brush can narrow, held as a *value* rather than a rectangle.
 *
 * The selection is kept as two dates and re-validated on every render instead of being
 * corrected by an effect: switching the bucket from Daily to Monthly replaces every x value
 * in the series, and a window pinned to dates that no longer exist would otherwise draw an
 * empty chart. A span that isn't in the current series simply falls back to all of it.
 *
 * A zero-width commit — what a blank click on the strip produces — is read as "show
 * everything" rather than as a one-day window, which is the only reading that leaves the
 * reader somewhere useful.
 */
export function useDateWindow(data: PnlPoint[]): DateWindow {
  const [brushed, setBrushed] = React.useState<BrushRange<string> | null>(null);

  return React.useMemo(() => {
    const dates = data.map((d) => d.date);
    const first = dates[0];
    const last = dates[dates.length - 1];
    const zoomed =
      brushed !== null &&
      brushed.start < brushed.end &&
      dates.includes(brushed.start) &&
      dates.includes(brushed.end);

    const range = zoomed
      ? brushed
      : first === undefined || last === undefined
        ? null
        : { start: first, end: last };
    const rows =
      zoomed && range
        ? data.filter((d) => d.date >= range.start && d.date <= range.end)
        : data;

    return { dates, range, rows, setRange: setBrushed, zoomed };
  }, [data, brushed]);
}

/**
 * The context strip under a detail chart: the whole series at a glance, with a draggable
 * window over it.
 *
 * It is a second chart rather than a brush laid over the first one because the two views
 * need different x domains — the strip has to keep the complete span to be draggable back
 * out, while the detail chart's domain *is* the selection. Sharing one scale between them
 * would make zooming a one-way trip.
 *
 * `brushX` owns the gesture (drag, reverse-drag, keyboard handles, snapping to real dates);
 * what the app owns is the accepted range. Datum focus is off here — there is nothing to
 * inspect on a 40px strip, and a tooltip would only fight the drag.
 */
export function SeriesBrush({
  data,
  field,
  color,
  range,
  onRange,
  label,
}: {
  /** The complete series — the strip always shows everything. */
  data: PnlPoint[];
  field: "pnl" | "value";
  color: string;
  range: BrushRange<string>;
  onRange: (next: BrushRange<string> | null) => void;
  label: string;
}) {
  const definition = React.useMemo(
    () =>
      defineChart({
        marks: [
          areaY(data, {
            x: "date",
            y1: 0,
            y2: field,
            fill: color,
            fillOpacity: 0.18,
            stroke: color,
            strokeWidth: 1,
          }),
        ],
        x: { scale: scalePoint<string> },
        y: { scale: scaleLinear },
        // No axes, grid or margins: the strip is a shape, not a reading.
        guides: false,
        theme: CHART_THEME,
        focus: focusDisabled,
        // Without this the host still lays a focus ring over every point in the series —
        // hundreds of circles in the DOM for a strip that can't be focused in the first
        // place.
        focusRing: false,
        tooltip: false,
        controls: [
          brushX({
            range: controlledSignal<BrushRange<string>, BrushXChange<string>>(
              range,
              (next, { reason }) => {
                // Previews repaint the handles on their own; only an accepted range is
                // worth re-deriving the detail chart for.
                if (reason.type !== "commit") return;
                onRange(next.start === next.end ? null : next);
              },
            ),
            values: data.map((d) => d.date),
            format: (date) => date,
            ariaLabel: label,
            startAriaLabel: "Window start",
            endAriaLabel: "Window end",
            // Both need an explicit stroke: the default outlines the selection in the
            // palette's first colour, which is a blue this app never uses.
            selectionStyle: {
              fill: "var(--foreground)",
              fillOpacity: 0.06,
              stroke: "var(--border)",
              strokeWidth: 1,
            },
            handleStyle: {
              fill: "var(--muted-foreground)",
              fillOpacity: 0.5,
              stroke: "var(--card)",
              strokeWidth: 1,
            },
            // The handle is drawn `handleSize` tall*er* than the plot so it stays grabbable
            // on a short strip; the default 24 overhangs far enough to sit on the axis
            // labels above it.
            handleSize: 9,
          }),
        ],
      }),
    [data, field, color, range, onRange, label],
  );

  return (
    <Chart
      definition={definition}
      height={40}
      initialWidth={900}
      className="w-full"
      ariaLabel={label}
    />
  );
}
