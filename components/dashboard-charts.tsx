"use client";

import * as React from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  XAxis, YAxis,
} from "recharts";
import type { Payload } from "@/lib/types";
import { fmtTr, fmtVND, MONTHS } from "@/lib/format";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip,
  ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { vndRow } from "@/components/vnd-tooltip";

/** Fixed slot per asset type — color follows the entity, never its rank. */
const TYPE_COLORS: Record<string, string> = {
  Funds: "var(--chart-1)",
  Stocks: "var(--chart-2)",
  Crypto: "var(--chart-3)",
  "Real Estate": "var(--chart-4)",
};
const typeColor = (t: string) => TYPE_COLORS[t] ?? "var(--chart-5)";

const typeConfig: ChartConfig = Object.fromEntries(
  Object.entries(TYPE_COLORS).map(([k, color]) => [k, { label: k, color }]),
);

export function DashboardCharts({ payload }: { payload: Payload }) {
  const yearKeys = Object.keys(payload.years).sort().reverse();
  const [year, setYear] = React.useState(yearKeys[0] ?? "");

  const monthly = React.useMemo(() => {
    const y = payload.years[year];
    if (!y) return [];
    return MONTHS.map((m, i) => ({
      month: m,
      total: y.totals[i],
      ...y.breakdown[i],
    }));
  }, [payload.years, year]);

  const typesInYear = React.useMemo(() => {
    const present = new Set<string>();
    for (const row of monthly)
      for (const k of Object.keys(row)) if (k in TYPE_COLORS) present.add(k);
    return Object.keys(TYPE_COLORS).filter((t) => present.has(t));
  }, [monthly]);

  const cumulative = React.useMemo(() => {
    const points: { label: string; invested: number }[] = [];
    let sum = 0;
    for (const y of Object.keys(payload.years).sort()) {
      payload.years[y].totals.forEach((v, i) => {
        sum += v;
        points.push({ label: `${MONTHS[i]} ${y.slice(2)}`, invested: sum });
      });
    }
    let last = points.length - 1;
    const finalSum = points[last]?.invested;
    while (last > 0 && points[last - 1].invested === finalSum) last -= 1;
    return points.slice(0, last + 1);
  }, [payload.years]);

  const allocation = payload.allocation.map((a) => ({
    ...a,
    fill: typeColor(a.type),
  }));

  const holdings = payload.portfolio.map((p) => ({
    ...p,
    fill: typeColor(p.type),
  }));

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div className="space-y-1.5">
              <CardTitle>Invested per month</CardTitle>
              <CardDescription>Contributions by asset type, {year}</CardDescription>
            </div>
            <Select value={year} onValueChange={(v) => v != null && setYear(v)}>
              <SelectTrigger className="w-24" size="sm" aria-label="Year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearKeys.map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <ChartContainer config={typeConfig} className="aspect-[2/1] w-full">
              <BarChart data={monthly} accessibilityLayer>
                <CartesianGrid vertical={false} strokeWidth={1} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={fmtTr} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(v, n, item) => vndRow(v, n, item)}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                {typesInYear.map((t, i) => (
                  <Bar isAnimationActive={false}
                    key={t}
                    dataKey={t}
                    stackId="m"
                    fill={typeColor(t)}
                    maxBarSize={24}
                    stroke="var(--card)"
                    strokeWidth={1}
                    radius={i === typesInYear.length - 1 ? [4, 4, 0, 0] : 0}
                  />
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cumulative invested</CardTitle>
            <CardDescription>Running total of all contributions</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{ invested: { label: "Invested", color: "var(--chart-1)" } }}
              className="aspect-[2/1] w-full"
            >
              <LineChart data={cumulative} accessibilityLayer>
                <CartesianGrid vertical={false} strokeWidth={1} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={fmtTr} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(v, n, item) => vndRow(v, n, item, { invested: "Invested" })}
                    />
                  }
                />
                <Line isAnimationActive={false}
                  dataKey="invested"
                  type="monotone"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Allocation</CardTitle>
            <CardDescription>Current value by asset type</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={typeConfig} className="mx-auto aspect-square max-h-72 w-full">
              <PieChart accessibilityLayer>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(v, n, item) => vndRow(v, n, item)}
                    />
                  }
                />
                <Pie isAnimationActive={false}
                  data={allocation}
                  dataKey="value"
                  nameKey="type"
                  innerRadius="55%"
                  strokeWidth={2}
                  stroke="var(--card)"
                />
                <ChartLegend content={<ChartLegendContent nameKey="type" />} />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Holdings</CardTitle>
            <CardDescription>
              Position values — <Badge variant="outline" className="align-middle">live</Badge>{" "}
              means quantity × live price
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={typeConfig}
              className="aspect-auto w-full"
              style={{ height: holdings.length * 40 + 32 }}
            >
              <BarChart data={holdings} layout="vertical" accessibilityLayer margin={{ left: 8 }}>
                <CartesianGrid horizontal={false} strokeWidth={1} />
                <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={fmtTr} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  width={96}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(v, _n, item) => {
                        const p = item.payload as (typeof holdings)[number];
                        return (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <div
                                className="h-2.5 w-1 shrink-0 rounded-[2px]"
                                style={{ backgroundColor: p.fill }}
                              />
                              <span className="text-muted-foreground">{p.type}</span>
                              <span className="ml-auto font-mono font-medium tabular-nums">
                                {fmtVND(Number(v))}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              cost {fmtVND(p.cost)} · P&L{" "}
                              <span
                                className={
                                  p.pnl >= 0
                                    ? "text-(--chart-positive)"
                                    : "text-(--chart-negative)"
                                }
                              >
                                {p.pnl >= 0 ? "+" : ""}
                                {fmtVND(p.pnl)}
                              </span>
                              {p.live ? " · live" : " · manual"}
                            </div>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Bar isAnimationActive={false} dataKey="value" maxBarSize={24} radius={[0, 4, 4, 0]}>
                  {holdings.map((h) => (
                    <Cell key={h.name} fill={h.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
