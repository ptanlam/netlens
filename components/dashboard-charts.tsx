"use client";

import * as React from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  XAxis, YAxis,
} from "recharts";
import { CalendarRange, Coins, Trophy } from "lucide-react";
import type { Payload } from "@/lib/types";
import { fmtTr, fmtVND, MONTHS } from "@/lib/format";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip,
  ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { vndRow } from "@/components/vnd-tooltip";
import { PnlChart } from "@/components/pnl-chart";
import { cn } from "@/lib/utils";

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

const PRESETS = ["Year to date", "This year", "Last 12 months", "All time", "Custom"] as const;
type Preset = (typeof PRESETS)[number];

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Resolve a preset to a concrete [from, to] range (ISO dates). */
function presetRange(preset: Preset, minDate: string): { from: string; to: string } {
  const now = new Date();
  const to = isoOf(now);
  const y = now.getFullYear();
  switch (preset) {
    case "This year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "Last 12 months": {
      const d = new Date(now);
      d.setFullYear(y - 1);
      return { from: isoOf(d), to };
    }
    case "All time":
      return { from: minDate, to };
    default: // Year to date
      return { from: `${y}-01-01`, to };
  }
}

/** Every month key (YYYY-MM) + display label between two ISO dates, inclusive. */
function monthsBetween(from: string, to: string): { key: string; label: string }[] {
  if (from > to) return [];
  const out: { key: string; label: string }[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      label: `${MONTHS[m - 1]} ${String(y).slice(2)}`,
    });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export function DashboardCharts({ payload }: { payload: Payload }) {
  const contributions = payload.contributions;
  const minDate = contributions[0]?.date ?? isoOf(new Date());
  const maxDate = isoOf(new Date());

  const [preset, setPreset] = React.useState<Preset>("Year to date");
  const [from, setFrom] = React.useState(() => presetRange("Year to date", minDate).from);
  const [to, setTo] = React.useState(() => presetRange("Year to date", minDate).to);

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p !== "Custom") {
      const r = presetRange(p, minDate);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  const inRange = React.useMemo(
    () => contributions.filter((c) => c.date >= from && c.date <= to),
    [contributions, from, to],
  );

  const monthBuckets = React.useMemo(() => monthsBetween(from, to), [from, to]);

  const monthly = React.useMemo(() => {
    const byKey: Record<string, Record<string, number>> = {};
    for (const c of inRange) {
      const k = c.date.slice(0, 7);
      (byKey[k] ??= {})[c.asset_type] = (byKey[k][c.asset_type] ?? 0) + c.amount;
    }
    return monthBuckets.map(({ key, label }) => {
      const cats = byKey[key] ?? {};
      const total = Object.values(cats).reduce((a, b) => a + b, 0);
      return { month: label, total, ...cats };
    });
  }, [inRange, monthBuckets]);

  const typesInRange = React.useMemo(() => {
    const present = new Set<string>();
    for (const row of monthly)
      for (const k of Object.keys(row)) if (k in TYPE_COLORS) present.add(k);
    return Object.keys(TYPE_COLORS).filter((t) => present.has(t));
  }, [monthly]);

  const cumulative = React.useMemo(() => {
    const totals = monthly.map((r) => r.total);
    return monthly.map((r, i) => ({
      label: r.month,
      invested: totals.slice(0, i + 1).reduce((a, b) => a + b, 0),
    }));
  }, [monthly]);

  const summary = React.useMemo(() => {
    const total = inRange.reduce((a, c) => a + c.amount, 0);
    const months = Math.max(monthBuckets.length, 1);
    let best: { label: string; value: number } | null = null;
    for (const r of monthly)
      if (!best || r.total > best.value) best = { label: r.month, value: r.total };
    return {
      total,
      avg: total / months,
      bestMonth: best?.label ?? "—",
      bestValue: best?.value ?? 0,
    };
  }, [inRange, monthBuckets, monthly]);

  const allocation = payload.allocation.map((a) => ({
    ...a,
    fill: typeColor(a.type),
  }));

  const holdings = payload.portfolio.map((p) => ({
    ...p,
    fill: typeColor(p.type),
  }));

  const pnlByHolding = payload.portfolio
    .filter((p) => p.pnl !== 0)
    .sort((a, b) => b.pnl - a.pnl)
    .map((p) => ({
      ...p,
      fill: p.pnl >= 0 ? "var(--chart-positive)" : "var(--chart-negative)",
    }));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Activity</h2>
          <p className="text-sm text-muted-foreground">
            Contributions and P&L from {from} to {to}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Select value={preset} onValueChange={(v) => v != null && applyPreset(v as Preset)}>
            <SelectTrigger className="w-full sm:w-40" size="sm" aria-label="Date range preset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            aria-label="From date"
            value={from}
            min={minDate}
            max={to}
            onChange={(e) => { setFrom(e.target.value); setPreset("Custom"); }}
            className="h-8 min-w-0 flex-1 sm:w-40 sm:flex-none"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            type="date"
            aria-label="To date"
            value={to}
            min={from}
            max={maxDate}
            onChange={(e) => { setTo(e.target.value); setPreset("Custom"); }}
            className="h-8 min-w-0 flex-1 sm:w-40 sm:flex-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard tone="teal" icon={Coins} label="Total invested" value={fmtVND(summary.total)} />
        <StatCard tone="blue" icon={CalendarRange} label="Monthly average" value={fmtVND(summary.avg)} />
        <StatCard
          tone="amber"
          icon={Trophy}
          label="Best month"
          value={`${summary.bestMonth} · ${fmtVND(summary.bestValue)}`}
        />
      </div>

      <PnlChart from={from} to={to} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Invested per month</CardTitle>
            <CardDescription>Contributions by asset type, per month in range</CardDescription>
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
                {typesInRange.map((t, i) => (
                  <Bar isAnimationActive={false}
                    key={t}
                    dataKey={t}
                    stackId="m"
                    fill={typeColor(t)}
                    maxBarSize={24}
                    stroke="var(--card)"
                    strokeWidth={1}
                    radius={i === typesInRange.length - 1 ? [4, 4, 0, 0] : 0}
                  />
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cumulative invested</CardTitle>
            <CardDescription>Running total within selected range</CardDescription>
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

      <div className="mt-2 space-y-1 border-t pt-6">
        <h2 className="text-lg font-semibold tracking-tight">Current portfolio</h2>
        <p className="text-sm text-muted-foreground">
          Live snapshot across all years — independent of the selected year
        </p>
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

      <Card>
        <CardHeader>
          <CardTitle>Profit &amp; loss by holding</CardTitle>
          <CardDescription>Unrealized gain / loss per position</CardDescription>
        </CardHeader>
        <CardContent>
          {pnlByHolding.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No gains or losses yet — set live quantities or holding values to see P&L.
            </p>
          ) : (
            <ChartContainer
              config={{ pnl: { label: "P&L" } }}
              className="aspect-auto w-full"
              style={{ height: pnlByHolding.length * 40 + 32 }}
            >
              <BarChart data={pnlByHolding} layout="vertical" accessibilityLayer margin={{ left: 8 }}>
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
                      hideLabel
                      formatter={(v, _n, item) => {
                        const p = item.payload as (typeof pnlByHolding)[number];
                        const pct = p.cost ? (p.pnl / p.cost) * 100 : 0;
                        return (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <div
                                className="h-2.5 w-1 shrink-0 rounded-[2px]"
                                style={{ backgroundColor: p.fill }}
                              />
                              <span className="text-muted-foreground">{p.type}</span>
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
                              cost {fmtVND(p.cost)} · {pct >= 0 ? "+" : ""}
                              {pct.toFixed(1)}%
                            </div>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Bar isAnimationActive={false} dataKey="pnl" maxBarSize={24} radius={[0, 4, 4, 0]}>
                  {pnlByHolding.map((h) => (
                    <Cell key={h.name} fill={h.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </>
  );
}
