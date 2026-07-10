"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { PnlPoint } from "@/lib/types";
import { fmtTr, fmtVND } from "@/lib/format";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { BUCKETS, type Bucket, bucketOf } from "@/components/pnl-chart";
import { cn } from "@/lib/utils";

const config: ChartConfig = {
  value: { label: "Net value", color: "var(--chart-2)" },
};

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

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="space-y-1.5">
          <CardTitle>Net value over time</CardTitle>
          <CardDescription>
            Estimated portfolio value from cached daily prices, anchored to current holdings
          </CardDescription>
        </div>
        <div className="flex gap-1">
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
            <ChartContainer config={config} className="aspect-[3/1] min-h-48 w-full">
              <AreaChart data={data} accessibilityLayer>
                <defs>
                  <linearGradient id="netValueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeWidth={1} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
                <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={fmtTr} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(v, _n, item) => {
                        const p = item.payload as PnlPoint;
                        return (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <div
                                className="h-2.5 w-1 shrink-0 rounded-[2px]"
                                style={{ backgroundColor: "var(--chart-2)" }}
                              />
                              <span className="text-muted-foreground">Net value</span>
                              <span className="ml-auto font-mono font-medium tabular-nums">
                                {fmtVND(Number(v))}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              Invested {fmtVND(p.invested)} · P&L{" "}
                              <span
                                className={cn(
                                  p.pnl >= 0 ? "text-(--chart-positive)" : "text-(--chart-negative)",
                                )}
                              >
                                {p.pnl >= 0 ? "+" : ""}
                                {fmtVND(p.pnl)}
                              </span>
                            </div>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Area
                  isAnimationActive={false}
                  dataKey="value"
                  type="monotone"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  fill="url(#netValueFill)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                />
              </AreaChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
