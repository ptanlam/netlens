"use client";

import * as React from "react";
import { CartesianGrid, ReferenceLine, XAxis, YAxis, Area, AreaChart } from "recharts";
import type { PnlPoint } from "@/lib/types";
import { fmtTr, fmtVND } from "@/lib/format";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

const BUCKETS = ["Daily", "Weekly", "Monthly", "Yearly"] as const;
type Bucket = (typeof BUCKETS)[number];

const config: ChartConfig = {
  pnl: { label: "P&L", color: "var(--chart-positive)" },
};

function bucketOf(date: string, b: Bucket): string {
  if (b === "Daily") return date;
  if (b === "Monthly") return date.slice(0, 7);
  if (b === "Yearly") return date.slice(0, 4);
  // Weekly: ISO week start (Monday)
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function PnlChart({ from, to }: { from: string; to: string }) {
  const [series, setSeries] = React.useState<PnlPoint[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [bucket, setBucket] = React.useState<Bucket>("Daily");

  React.useEffect(() => {
    let alive = true;
    fetch("/api/pnl-history")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { series: PnlPoint[] }) => alive && setSeries(d.series))
      .catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
  }, []);

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

  // Fraction of the chart height above the zero line — used to split the
  // gradient so gains render green and losses red (matches the Flask chart).
  const zeroOffset = React.useMemo(() => {
    if (!data.length) return 1;
    const vals = data.map((d) => d.pnl);
    const max = Math.max(...vals, 0);
    const min = Math.min(...vals, 0);
    if (max <= 0) return 0;
    if (min >= 0) return 1;
    return max / (max - min);
  }, [data]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="space-y-1.5">
          <CardTitle>P&L over time</CardTitle>
          <CardDescription>
            Estimated from cached daily prices, anchored to current holdings
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
            Couldn&apos;t load P&L history: {error}
          </p>
        ) : (
          <div className={cn(!series && "opacity-50")}>
            <ChartContainer config={config} className="aspect-[3/1] min-h-48 w-full">
              <AreaChart data={data} accessibilityLayer>
                <defs>
                  <linearGradient id="pnlStroke" x1="0" y1="0" x2="0" y2="1">
                    <stop offset={zeroOffset} stopColor="var(--chart-positive)" />
                    <stop offset={zeroOffset} stopColor="var(--chart-negative)" />
                  </linearGradient>
                  <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset={zeroOffset} stopColor="var(--chart-positive)" stopOpacity={0.2} />
                    <stop offset={zeroOffset} stopColor="var(--chart-negative)" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeWidth={1} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
                <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={fmtTr} />
                <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(v, _n, item) => {
                        const p = item.payload as PnlPoint;
                        return (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">P&L</span>
                              <span
                                className={cn(
                                  "ml-auto font-mono font-medium tabular-nums",
                                  p.pnl >= 0
                                    ? "text-(--chart-positive)"
                                    : "text-(--chart-negative)",
                                )}
                              >
                                {p.pnl >= 0 ? "+" : ""}
                                {fmtVND(Number(v))}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              Invested {fmtVND(p.invested)} · Value {fmtVND(p.value)}
                            </div>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Area
                  isAnimationActive={false}
                  dataKey="pnl"
                  type="monotone"
                  baseValue={0}
                  stroke="url(#pnlStroke)"
                  strokeWidth={2}
                  fill="url(#pnlFill)"
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
