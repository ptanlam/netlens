"use client";

import * as React from "react";
import { areaY, defineChart } from "@tanstack/charts";
import { focusDisabled } from "@tanstack/charts/focus/disabled";
import { brushX, type BrushRange, type BrushXChange } from "@tanstack/charts/interaction/brush";
import { controlledSignal } from "@tanstack/charts/interaction/signal";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";

import { CHART_THEME } from "@/components/ui/chart";

/**
 * The one thing every series here has in common: an ISO date per row. It is the brush's
 * step *and* its label, so a strip can be built over any dated series — P&L, a savings
 * balance, capital deployed — without the strip knowing what it is plotting.
 */
export interface Dated {
  date: string;
}

/**
 * The keys of `TDatum` whose value is a number, i.e. the ones a strip could plot. Naming
 * the field rather than taking an accessor keeps the call sites reading like the marks
 * they sit next to (`field="pnl"`, `y="pnl"`).
 */
export type NumericField<TDatum> = {
  [TKey in Extract<keyof TDatum, string>]-?: TDatum[TKey] extends number ? TKey : never;
}[Extract<keyof TDatum, string>];

/**
 * Below this many points a strip can't do anything useful: a dozen steps are
 * all legible at once on the detail chart, and a window over three of them only hides two.
 * Callers check it before rendering a brush at all — an affordance that can't change what
 * you see is worse than no affordance.
 */
export const BRUSH_MIN_POINTS = 12;

/** The window a brush has selected, or the whole span when it hasn't. */
export interface DateWindow<TDatum> {
  /** Every date in the series, in order — the brush's semantic steps. */
  dates: string[];
  /** The selected span. Null only when the series is empty. */
  range: BrushRange<string> | null;
  /** The rows inside that span — what the detail chart actually draws. */
  rows: TDatum[];
  setRange: (next: BrushRange<string> | null) => void;
  /** Whether the reader has narrowed the view, i.e. whether a reset means anything. */
  zoomed: boolean;
}

/**
 * A date window a brush can narrow, held as a *value* rather than a rectangle.
 *
 * What it is narrowing is whatever series it is handed — on the panels with a date picker
 * that is the picked window, not the whole history, so the strip spans exactly the preset
 * and an untouched brush fills it. Clearing the selection when the picker moves is the
 * caller's job; the fallback below only catches a series whose dates changed underneath.
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
export function useDateWindow<TDatum extends Dated>(data: TDatum[]): DateWindow<TDatum> {
  const [brushed, setBrushed] = React.useState<BrushRange<string> | null>(null);

  return React.useMemo(() => {
    const dates = data.map((d) => d.date);
    const first = dates[0];
    const last = dates[dates.length - 1];
    const zoomed =
      brushed !== null &&
      brushed.start < brushed.end &&
      dates.includes(brushed.start) &&
      dates.includes(brushed.end) &&
      // A window that still spans everything is not a zoom. The brush hands one back for a
      // drag *inside* a full-width selection — the gesture means "pan", and at full width
      // there is nowhere to pan to — and taking that at face value offered a "Reset zoom"
      // for a view identical to the one it would have reset to.
      !(brushed.start === first && brushed.end === last);

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
 * need different x domains — the strip keeps the whole span it was given, so a zoom can be
 * dragged back out, while the detail chart's domain *is* the selection. Sharing one scale
 * between them would make zooming a one-way trip.
 *
 * `brushX` owns the gesture (drag, reverse-drag, keyboard handles, snapping to real dates);
 * what the app owns is the accepted range. Datum focus is off here — there is nothing to
 * inspect on a 40px strip, and a tooltip would only fight the drag.
 */
export function SeriesBrush<TDatum extends Dated>({
  data,
  field,
  color,
  range,
  onRange,
  label,
}: {
  /** The series the strip shows end to end — for a panel with a date picker, the window
   *  that picker chose. */
  data: TDatum[];
  /** Which number on the row the strip draws. */
  field: NumericField<TDatum>;
  color: string;
  range: BrushRange<string>;
  onRange: (next: BrushRange<string> | null) => void;
  label: string;
}) {
  /**
   * The series flattened to the two values a strip actually draws, one row per date.
   *
   * Not just tidiness on either count. Handing `defineChart` a mark over a type *parameter*
   * leaves its x value unresolved, and the brush control below — which has to agree with
   * that x — then fails to typecheck for every caller at once; a concrete row type keeps the
   * inference local to this component, which is where the generic was meant to stop anyway.
   * (`field` is constrained to a numeric key, so the cast only restates what the constraint
   * already guarantees.) And the brush's steps have to be *unique*: a sampled series can
   * land on the same calendar day twice — `buildDailySeries` ends on "now", which is usually
   * the same date as its last step — and the duplicate throws the control outright. Keeping
   * the last row for a date is the reading that matches the strip: a day is one step.
   */
  const rows = React.useMemo(() => {
    const byDate = new Map<string, number>();
    for (const d of data) byDate.set(d.date, d[field] as unknown as number);
    return Array.from(byDate, ([date, v]) => ({ date, v }));
  }, [data, field]);

  const definition = React.useMemo(
    () =>
      defineChart({
        marks: [
          areaY(rows, {
            x: "date",
            y1: 0,
            y2: "v",
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
            values: rows.map((d) => d.date),
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
    [rows, color, range, onRange, label],
  );

  return (
    // Double-click anywhere on the strip clears the selection — the gesture every zoomable
    // chart uses for "back to everything", and the only one that works *inside* a selection,
    // where a single click is a pan.
    //
    // Capture phase, not bubble: the brush's own overlay stops click events from propagating
    // (it has to, or every drag would end in a stray click on whatever is underneath), so a
    // plain `onDoubleClick` here never fires.
    <div
      className="w-full"
      onDoubleClickCapture={() => onRange(null)}
      title="Double-click to reset"
    >
      <Chart
        definition={definition}
        height={40}
        initialWidth={900}
        className="w-full"
        ariaLabel={`${label} — double-click to reset`}
      />
    </div>
  );
}
