"use client";

import * as React from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { PnlPoint } from "@/lib/types";
import { fmtTr } from "@/lib/format";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip,
  ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { vndRow } from "@/components/vnd-tooltip";
import { cn } from "@/lib/utils";

const BUCKETS = ["Daily", "Weekly", "Monthly", "Yearly"] as const;
type Bucket = (typeof BUCKETS)[number];

const config: ChartConfig = {
  value: { label: "Portfolio value", color: "var(--chart-1)" },
  invested: { label: "Invested", color: "var(--chart-2)" },
};
const LABELS = { value: "Portfolio value", invested: "Invested", pnl: "P&L" };

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

export function PnlChart() {
  const [series, setSeries] = React.useState<PnlPoint[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [bucket, setBucket] = React.useState<Bucket>("Weekly");

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
    // last point of each bucket
    const out: PnlPoint[] = [];
    for (const p of series) {
      const key = bucketOf(p.date, bucket);
      if (out.length && bucketOf(out[out.length - 1].date, bucket) === key)
        out[out.length - 1] = p;
      else out.push(p);
    }
    return out;
  }, [series, bucket]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="space-y-1.5">
          <CardTitle>P&L over time</CardTitle>
          <CardDescription>
            Estimated from cached daily prices; the last point matches the live P&L card
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
              <LineChart data={data} accessibilityLayer>
                <CartesianGrid vertical={false} strokeWidth={1} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} />
                <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={fmtTr} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(v, n, item) => vndRow(v, n, item, LABELS)}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Line isAnimationActive={false} dataKey="value" type="monotone" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                <Line isAnimationActive={false} dataKey="invested" type="monotone" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
