"use client";

import * as React from "react";
import { areaY, defineChart, lineY, ruleY } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import type { PnlPoint } from "@/lib/types";
import { fmtMil, fmtVND } from "@/lib/format";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { bareAxis, CHART_HOST_STYLE, CHART_THEME } from "@/components/ui/chart";
import { SeriesBrush, useDateWindow } from "@/components/chart-brush";
import { cn } from "@/lib/utils";

export const BUCKETS = ["Daily", "Weekly", "Monthly", "Yearly"] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Collapse an ISO date to the key of the bucket it belongs to. */
export function bucketOf(date: string, b: Bucket): string {
  if (b === "Daily") return date;
  if (b === "Monthly") return date.slice(0, 7);
  if (b === "Yearly") return date.slice(0, 4);
  // Weekly: ISO week start (Monday)
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function PnlChart({
  from,
  to,
  series,
  error,
}: {
  from: string;
  to: string;
  series: PnlPoint[] | null;
  error: string | null;
}) {
  const [bucket, setBucket] = React.useState<Bucket>("Daily");

  const data = React.useMemo(() => {
    if (!series) return [];
    // last point of each bucket, within the selected date range
    const out: PnlPoint[] = [];
    for (const p of series) {
      if (p.date < from || p.date > to) continue;
      const key = bucketOf(p.date, bucket);
      if (out.length && bucketOf(out[out.length - 1].date, bucket) === key)
        out[out.length - 1] = p;
      else out.push(p);
    }
    return out;
  }, [series, bucket, from, to]);

  const view = useDateWindow(data);

  // Fraction of the chart height above the zero line — used to split the
  // gradient so gains render green and losses red (matches the Flask chart).
  // Measured against the *visible* rows: brush into a stretch that never went under and
  // the whole band should be green, however red the year as a whole was.
  const zeroOffset = React.useMemo(() => {
    const rows = view.rows;
    if (!rows.length) return 1;
    const vals = rows.map((d) => d.pnl);
    const max = Math.max(...vals, 0);
    const min = Math.min(...vals, 0);
    if (max <= 0) return 0;
    if (min >= 0) return 1;
    return max / (max - min);
  }, [view.rows]);

  const definition = React.useMemo(
    () =>
      defineChart({
        marks: [
          crosshair({ x: true, y: false }),
          // Explicit endpoints — the band is what the P&L is *against zero*, so the
          // baseline is the number 0 and not wherever the axis happens to start.
          areaY(view.rows, {
            x: "date",
            y1: 0,
            y2: "pnl",
            fill: "url(#pnlFill)",
            fillOpacity: 1,
          }),
          ruleY([0], { stroke: "var(--border)", strokeWidth: 1 }),
          lineY(view.rows, { x: "date", y: "pnl", stroke: "url(#pnlStroke)", strokeWidth: 2 }),
        ],
        // Both gradients are two stops at the same offset: a hard switch from green to red
        // exactly where the shape crosses zero, rather than a blend through the middle.
        // The offsets are fractions of each shape's own box, which is why `zeroOffset` is
        // measured from the data and not from the axis.
        gradients: [
          {
            id: "pnlStroke",
            y1: 0,
            y2: 1,
            stops: [
              { offset: zeroOffset, color: "var(--chart-positive)" },
              { offset: zeroOffset, color: "var(--chart-negative)" },
            ],
          },
          {
            id: "pnlFill",
            y1: 0,
            y2: 1,
            stops: [
              { offset: zeroOffset, color: "var(--chart-positive)", opacity: 0.2 },
              { offset: zeroOffset, color: "var(--chart-negative)", opacity: 0.2 },
            ],
          },
        ],
        x: { scale: scalePoint<string>, axis: bareAxis<string>({ minGap: 32 }) },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: bareAxis<number>({ format: fmtMil }),
        },
        theme: CHART_THEME,
        // A date is the thing you point at on a time series; the vertical distance to the
        // line is beside the point, and an infinite radius means the cursor never falls
        // into a gap between two days.
        focus: "nearest-x",
        maxFocusDistance: Number.POSITIVE_INFINITY,
        // `content` hands the built-in tooltip a title, rows and swatch colours and lets it
        // do the rendering — the surface, the grid, the pinning and the keyboard path are
        // all the library's. Only the words are ours.
        tooltip: {
          use: tooltip,
          content: (points) => {
            const p = points[0]?.datum;
            if (!p) return { rows: [] };
            return {
              title: p.date,
              rows: [
                {
                  label: "P&L",
                  value: `${p.pnl >= 0 ? "+" : ""}${fmtVND(p.pnl)}`,
                  // The swatch carries the sign: a plaintext row can't colour its own
                  // value, and green-or-red is the first thing you read off this chart.
                  color: p.pnl >= 0 ? "var(--chart-positive)" : "var(--chart-negative)",
                },
                { label: "Invested", value: fmtVND(p.invested) },
                { label: "Value", value: fmtVND(p.value) },
              ],
            };
          },
        },
      }),
    [view.rows, zeroOffset],
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="space-y-1.5">
          <CardTitle>P&L over time</CardTitle>
          <CardDescription>
            Estimated from cached daily prices, anchored to current holdings
          </CardDescription>
        </div>
        <div className="flex items-center gap-1">
          {/* Only offered once it means something — a reset button on an unbrushed chart
              is a control that does nothing, which is worse than no control. */}
          {view.zoomed && (
            <Button
              size="sm"
              variant="ghost"
              className="mr-1 text-muted-foreground"
              onClick={() => view.setRange(null)}
            >
              Reset zoom
            </Button>
          )}
          {BUCKETS.map((b) => (
            <Button
              key={b}
              size="sm"
              variant={bucket === b ? "secondary" : "ghost"}
              className={cn(bucket !== b && "text-muted-foreground")}
              onClick={() => setBucket(b)}
            >
              {b}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Couldn&apos;t load P&L history: {error}
          </p>
        ) : (
          <div className={cn(!series && "opacity-50")}>
            <Chart
              definition={definition}
              aspectRatio={3}
              initialWidth={900}
              className="w-full"
              style={{ ...CHART_HOST_STYLE, minHeight: "12rem" }}
              ariaLabel="Profit and loss over time"
            />
            {view.range && data.length > 1 && (
              <div className="mt-1.5">
                <SeriesBrush
                  data={data}
                  field="pnl"
                  color="var(--chart-positive)"
                  range={view.range}
                  onRange={view.setRange}
                  label="Drag to narrow the P&L date range"
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
