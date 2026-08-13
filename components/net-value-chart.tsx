"use client";

import * as React from "react";
import { areaY, defineChart, lineY } from "@tanstack/charts";
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
import { BUCKETS, type Bucket, bucketOf } from "@/components/pnl-chart";
import { cn } from "@/lib/utils";

export function NetValueChart({
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
    // keep the last point of each bucket, within the selected date range
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

  const definition = React.useMemo(
    () =>
      defineChart({
        marks: [
          crosshair({ x: true, y: false }),
          areaY(view.rows, {
            x: "date",
            y1: 0,
            y2: "value",
            fill: "url(#netValueFill)",
            fillOpacity: 1,
          }),
          lineY(view.rows, {
            x: "date",
            y: "value",
            stroke: "var(--chart-2)",
            strokeWidth: 2,
          }),
        ],
        // Fading out downward rather than a flat wash: the line is the figure, and the
        // band under it should say "this much" without competing with it.
        gradients: [
          {
            id: "netValueFill",
            y1: 0,
            y2: 1,
            stops: [
              { offset: 0, color: "var(--chart-2)", opacity: 0.25 },
              { offset: 1, color: "var(--chart-2)", opacity: 0.02 },
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
        focus: "nearest-x",
        maxFocusDistance: Number.POSITIVE_INFINITY,
        // Rows and swatches handed to the built-in tooltip rather than rendered in React:
        // the surface, pinning and keyboard path stay the library's.
        tooltip: {
          use: tooltip,
          content: (points) => {
            const p = points[0]?.datum;
            if (!p) return { rows: [] };
            return {
              title: p.date,
              rows: [
                { label: "Net value", value: fmtVND(p.value), color: "var(--chart-2)" },
                { label: "Invested", value: fmtVND(p.invested) },
                {
                  label: "P&L",
                  value: `${p.pnl >= 0 ? "+" : ""}${fmtVND(p.pnl)}`,
                  color: p.pnl >= 0 ? "var(--chart-positive)" : "var(--chart-negative)",
                },
              ],
            };
          },
        },
      }),
    [view.rows],
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="space-y-1.5">
          <CardTitle>Net value over time</CardTitle>
          <CardDescription>
            Estimated portfolio value from cached daily prices, anchored to current holdings
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
            Couldn&apos;t load net-value history: {error}
          </p>
        ) : (
          <div className={cn(!series && "opacity-50")}>
            <Chart
              definition={definition}
              aspectRatio={3}
              initialWidth={900}
              className="w-full"
              style={{ ...CHART_HOST_STYLE, minHeight: "12rem" }}
              ariaLabel="Portfolio net value over time"
            />
            {view.range && data.length > 1 && (
              <div className="mt-1.5">
                <SeriesBrush
                  data={data}
                  field="value"
                  color="var(--chart-2)"
                  range={view.range}
                  onRange={view.setRange}
                  label="Drag to narrow the net-value date range"
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
