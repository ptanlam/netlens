"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, CalendarClock, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { defineChart, rect } from "@tanstack/charts";
import { crosshair } from "@tanstack/charts/crosshair";
import { controlledSignal } from "@tanstack/charts/interaction/signal";
import {
  interactiveColorLegend, type InteractiveColorLegendChange,
} from "@tanstack/charts/legend";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { toast } from "sonner";
import {
  BILLING_CYCLES, BILLING_CYCLE_LABELS, BILLING_CYCLE_UNITS,
  SUBSCRIPTION_CATEGORIES, type Subscription,
} from "@/lib/types";
import {
  addSubscription, cancelSubscription, deleteSubscription, updateSubscription,
} from "@/app/actions";
import { fmtMil, fmtVND, MONTHS } from "@/lib/format";
import {
  daysUntil, monthlyCost, monthlyForecast, nextRenewal, spentToDate, summarize, yearlyCost,
} from "@/lib/subscriptions";
import { DataTable } from "@/components/data-table";
import { EntityAvatar } from "@/components/entity-avatar";
import { PageHeader } from "@/components/page-header";
import { PanelHead } from "@/components/panel-head";
import { SummaryCards } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  bareAxis, CHART_HOST_STYLE, CHART_MOTION, CHART_THEME, CHIP_LEGEND_CLASS, ChipLegendStyle,
  INITIAL_PANEL_WIDTH, legendChartMetrics, legendItemWidth, useLegendBand, usePanelWidth,
} from "@/components/ui/chart";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { IconTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ActionResult = { ok: boolean; message: string };

/** A charge this close is one you can still do something about — cancel it, or move the
 *  money — which is the only reason to surface it above the table. */
const SOON_DAYS = 7;

/** How far the commitment chart looks ahead. A year, so every annual renewal appears
 *  exactly once and the lumps are all visible together. */
const FORECAST_MONTHS = 12;

/** A fixed slot per category, like `TYPE_COLORS` for asset types: colour follows the kind
 *  of thing, never its rank in the list, so a plan keeps its colour as costs change.
 *  "Other" is deliberately absent — it takes `EntityAvatar`'s neutral tile.
 *
 *  Six named categories, five hues: Health and Education share green, and they're adjacent
 *  in the list so it reads as a pair rather than a collision — both are money spent on
 *  yourself. Same trade the nav makes for its sixth section. Leaving Education uncoloured
 *  was the alternative, and it would have been indistinguishable from "Other". */
const CATEGORY_COLORS: Record<string, string> = {
  Entertainment: "var(--chart-5)",
  Software: "var(--chart-1)",
  Utilities: "var(--chart-3)",
  Health: "var(--chart-4)",
  Education: "var(--chart-4)",
  Finance: "var(--chart-2)",
};

interface SubRow {
  sub: Subscription;
  monthly: number;
  yearly: number;
  /** Null once cancelled — nothing is ever billed again. */
  next: string | null;
  /** Days from today to `next`; `Infinity` when there is none, so sorting parks cancelled
   *  plans at the far end instead of scattering them through the live ones. */
  days: number;
  spent: number;
  cancelled: boolean;
}

function SubscriptionForm({
  action,
  sub,
  today,
  onDone,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  sub?: Subscription;
  today: string;
  onDone?: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [cycle, setCycle] = React.useState(sub?.cycle ?? "monthly");
  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          const res = await action(fd);
          if (res.ok) {
            toast.success(res.message);
            if (!sub) formRef.current?.reset();
            onDone?.();
          } else toast.error(res.message);
        })
      }
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="grid gap-2">
        <Label htmlFor="sub-name">Name</Label>
        <Input id="sub-name" name="name" defaultValue={sub?.name} placeholder="e.g. Spotify" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="sub-amount">Amount per {BILLING_CYCLE_UNITS[cycle]} (VND)</Label>
        <CurrencyInput id="sub-amount" name="amount" defaultValue={sub?.amount} placeholder="59.000" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="sub-cycle">Billing cycle</Label>
        <Select name="cycle" value={cycle} onValueChange={(v) => setCycle((v as typeof cycle) ?? "monthly")}>
          <SelectTrigger id="sub-cycle" className="w-full">
            <SelectValue>{BILLING_CYCLE_LABELS[cycle]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {BILLING_CYCLES.map((c) => (
              <SelectItem key={c} value={c}>{BILLING_CYCLE_LABELS[c]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="sub-start">First charge</Label>
        {/* Not "start date": every future renewal is counted forward from this day, so a
            plan that bills on the 28th needs the 28th here, not the day you signed up. */}
        <Input id="sub-start" name="start_date" type="date" defaultValue={sub?.start_date ?? today} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="sub-category">Category</Label>
        <Select name="category" defaultValue={sub?.category ?? "Other"}>
          <SelectTrigger id="sub-category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUBSCRIPTION_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="sub-method">Paid with (optional)</Label>
        <Input id="sub-method" name="payment_method" defaultValue={sub?.payment_method ?? undefined} placeholder="e.g. Techcombank Visa" />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="sub-note">Note (optional)</Label>
        <Input id="sub-note" name="note" defaultValue={sub?.note ?? undefined} />
      </div>
      <p className="text-[12.5px] text-muted-foreground sm:col-span-2">
        A subscription is spending, not an asset — it never touches net worth. What it buys
        you here is the ₫/month it commits you to, and the renewal before it lands.
      </p>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : sub ? "Update subscription" : "Add subscription"}
        </Button>
      </div>
    </form>
  );
}

function AddSubscriptionDialog({ today }: { today: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="size-3.5" />
        New subscription
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New subscription</DialogTitle>
        </DialogHeader>
        <SubscriptionForm action={addSubscription} today={today} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EditSubscriptionDialog({ sub, today }: { sub: Subscription; today: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <IconTooltip label="Edit subscription">
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit subscription" />}>
          <Pencil className="size-3.5" />
        </DialogTrigger>
      </IconTooltip>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit subscription</DialogTitle>
        </DialogHeader>
        <SubscriptionForm
          action={(fd) => updateSubscription(sub.id, fd)}
          sub={sub}
          today={today}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Stop a plan billing, or put it back on its schedule. Cancelling keeps the row and what
 *  it has cost you — deleting is for something you never actually subscribed to. */
function CancelSubscriptionButton({ sub }: { sub: Subscription }) {
  const [pending, startTransition] = React.useTransition();
  const cancelled = sub.cancelled_date != null;
  return (
    <IconTooltip label={cancelled ? "Resume subscription" : "Cancel — stop billing from today"}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={cancelled ? "Resume subscription" : "Cancel subscription"}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await cancelSubscription(sub.id, !cancelled);
            if (res.ok) toast.success(res.message);
            else toast.error(res.message);
          })
        }
      >
        {cancelled ? <RotateCcw className="size-3.5" /> : <Ban className="size-3.5" />}
      </Button>
    </IconTooltip>
  );
}

function DeleteSubscriptionButton({ sub }: { sub: Subscription }) {
  const [pending, startTransition] = React.useTransition();
  return (
    <IconTooltip label="Delete subscription">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete subscription"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Delete ${sub.name}? Cancel it instead to keep what it has cost you.`)) return;
          startTransition(async () => {
            const res = await deleteSubscription(sub.id);
            if (res.ok) toast.success(res.message);
            else toast.error(res.message);
          });
        }}
      >
        <Trash2 className="size-3.5 text-destructive" />
      </Button>
    </IconTooltip>
  );
}

/** Built per-render rather than declared at module scope: the edit dialog needs `today`,
 *  which only the page knows. Memoized by the caller, so TanStack still sees one stable
 *  array across renders. */
function makeColumns(today: string): ColumnDef<SubRow>[] {
  return [
  {
    id: "name",
    header: "Subscription",
    accessorFn: (r) => r.sub.name,
    size: 210,
    cell: ({ row }) => {
      const s = row.original.sub;
      return (
        <div className="flex items-center gap-2.5">
          <EntityAvatar name={s.name} color={CATEGORY_COLORS[s.category]} />
          <div className="min-w-0">
            <div className="truncate font-medium">{s.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {fmtVND(s.amount)} / {BILLING_CYCLE_UNITS[s.cycle]}
              {s.payment_method ? ` · ${s.payment_method}` : ""}
            </div>
          </div>
        </div>
      );
    },
  },
  {
    id: "category",
    header: "Category",
    enableSorting: false,
    size: 120,
    cell: ({ row }) => <Badge variant="tag">{row.original.sub.category}</Badge>,
  },
  {
    id: "next",
    header: "Next charge",
    accessorFn: (r) => r.days,
    size: 150,
    cell: ({ row }) => {
      const r = row.original;
      if (r.cancelled)
        return (
          <span className="text-muted-foreground tabular-nums">
            Cancelled {r.sub.cancelled_date}
          </span>
        );
      return (
        <div>
          <div className="tabular-nums">{r.next}</div>
          <div className={cn("text-xs", r.days <= SOON_DAYS ? "text-warning" : "text-muted-foreground")}>
            {r.days === 0 ? "today" : r.days === 1 ? "tomorrow" : `in ${r.days} days`}
          </div>
        </div>
      );
    },
  },
  {
    id: "monthly",
    header: "Per month",
    accessorFn: (r) => r.monthly,
    size: 130,
    meta: { align: "right" },
    cell: ({ row }) => (
      // A cancelled plan costs nothing from here on, so it loses the emphasis — the figure
      // stays visible as what it *used* to commit you to.
      <span
        className={cn(
          "font-mono font-medium tabular-nums",
          row.original.cancelled ? "text-muted-foreground line-through" : "text-(--chart-negative)",
        )}
      >
        {fmtVND(row.original.monthly)}
      </span>
    ),
  },
  {
    id: "yearly",
    header: "Per year",
    accessorFn: (r) => r.yearly,
    size: 130,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="font-mono tabular-nums text-muted-foreground">
        {fmtVND(row.original.yearly)}
      </span>
    ),
  },
  {
    id: "spent",
    header: "Spent so far",
    accessorFn: (r) => r.spent,
    size: 130,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="font-mono tabular-nums text-muted-foreground">
        {row.original.spent ? fmtVND(row.original.spent) : "—"}
      </span>
    ),
  },
  {
    id: "actions",
    header: "",
    enableSorting: false,
    size: 120,
    cell: ({ row }) => (
      <div className="flex justify-end gap-1">
        <EditSubscriptionDialog sub={row.original.sub} today={today} />
        <CancelSubscriptionButton sub={row.original.sub} />
        <DeleteSubscriptionButton sub={row.original.sub} />
      </div>
    ),
  },
  ];
}

/** The five hues the theme defines, as chart series slots. */
const SERIES_HUES = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)",
];

/**
 * A plan's slot in the stack: one paint, derived from the row's own id and never from its
 * position in the list — so a plan keeps its colour when one above it is added, cancelled
 * or deleted. Colour follows the entity, never its rank.
 *
 * Every second trip round the five hues comes back at half strength, which is what turns
 * five theme colours into ten telling-apart-able series: two plans collide only if their
 * ids are ten apart, not five. The weaker variant mixes toward *transparent* — that is
 * alpha, not a lightening step, so it reads as the same hue in both themes. Mixing toward
 * the card instead would lighten it in Daylight and darken it in Midnight.
 *
 * One string rather than a `{ fill, opacity }` pair because a mark takes a single paint per
 * segment: the colour scale maps a plan's id straight to what its rectangle is painted.
 */
function seriesFill(sub: Subscription): string {
  const hue = SERIES_HUES[sub.id % SERIES_HUES.length];
  return Math.floor(sub.id / SERIES_HUES.length) % 2 === 0
    ? hue
    : `color-mix(in srgb, ${hue} 55%, transparent)`;
}

/**
 * One rectangle: what a single plan charges in a single month, and where that sits in the
 * column.
 *
 * The chart's rows are one segment per charge, not one row per month with a column per
 * plan. That is the shape the data actually has — a month a plan doesn't bill simply has no
 * row, so hovering December lists what December charges instead of every plan you own with
 * a row of zeros.
 *
 * `base`/`top` are the stack, computed here rather than left to the mark's own stacking:
 * spelling the endpoints out is what lets each segment carry a hairline border (see below),
 * and the running sum is the same one line either way.
 */
interface ForecastSegment {
  sub: Subscription;
  month: string;
  /** Tooltip heading — "Aug 2027", since the window crosses a year boundary. */
  full: string;
  /** What this plan charges in this month. */
  amount: number;
  /** Everything the column charges — the figure its height means. */
  total: number;
  base: number;
  top: number;
}

/**
 * What the next twelve months bill, one segment per subscription.
 *
 * The point of the panel is the lumps. A ₫/month figure spreads an annual renewal evenly
 * across the year, which is exactly the month you'd want warning about — here it stands up
 * as a column three times its neighbours', and the stack says which plan did it.
 */
function ForecastPanel({
  segments,
  months,
  billed,
}: {
  segments: ForecastSegment[];
  /** Every month in the window, in order — the x domain. Given explicitly because a month
   *  that charges nothing has no segment, and an inferred domain would drop its column. */
  months: string[];
  /** The plans that bill at least once in the window, in stacking order (biggest first, so
   *  the heaviest commitment is the base of every column), each with its paint. */
  billed: { sub: Subscription; fill: string }[];
}) {
  /**
   * The one plan the reader has singled out, if any.
   *
   * A stack answers "what do I owe in March"; it is bad at "what does *this* plan cost me
   * across the year", because a segment's height is only readable against a baseline that
   * moves under it. Isolating drops the plan to the floor in every month, which is the only
   * way to compare its own months to each other.
   */
  const [only, setOnly] = React.useState<number | null>(null);

  const [width, measure] = usePanelWidth(INITIAL_PANEL_WIDTH);
  const [band, watchLegend] = useLegendBand();

  // The isolated plan starts from zero rather than keeping its place in the stack: with
  // nothing under it, the space below a floating segment would read as another plan's.
  const shown = React.useMemo(
    () =>
      only === null
        ? segments
        : segments
            .filter((s) => s.sub.id === only)
            .map((s) => ({ ...s, base: 0, top: s.amount })),
    [segments, only],
  );

  const definition = React.useMemo(
    () =>
      defineChart({
        marks: [
          // Underlay, so the hovered month lights up behind its column rather than washing
          // over it. `inset` is negative to widen the band back past the bar's own padding,
          // which makes the cursor read as "this month" and not "this bar".
          crosshair({
            // Full strength: `--muted` is already a pale surface colour, and the guide's
            // own 12% default would leave it invisible on the card.
            x: { band: { fill: "var(--muted)", fillOpacity: 1, inset: -5, radius: 4 } },
            y: false,
          }),
          rect(shown, {
            x: "month",
            y1: "base",
            y2: "top",
            // The plan is the series, and saying so is what makes a column's segments one
            // thing: grouped focus collects one point per series at the hovered month, so
            // without `z` every segment would look like the same series and the tooltip
            // would list a single row. Colour follows `z`, which is why the scale below is
            // keyed by plan id.
            z: (s) => s.sub.id,
            key: (s) => `${s.month}:${s.sub.id}`,
            // A hairline in the panel's own colour, so two plans that share a hue still
            // read as two segments where they meet.
            stroke: "var(--card)",
            strokeWidth: 1,
            inset: 0,
          }),
        ],
        x: {
          // An instance, not a factory: the domain is ours (all twelve months), and only a
          // configured scale keeps its own.
          scale: scaleBand<string>().domain(months).padding(0.26),
          axis: bareAxis<string>({ format: (m) => MONTHS[Number(m.slice(5, 7)) - 1] }),
        },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: bareAxis<number>({ format: fmtMil }),
        },
        color: {
          // The full domain either way, so isolating a plan doesn't drop the others out of
          // the legend — the legend is how you get back.
          domain: billed.map(({ sub }) => sub.id),
          range: billed.map(({ fill }) => fill),
          /**
           * The legend is the library's: pressed-state buttons, keyboard order, layout and
           * the swatches all come with it. What stays ours is the *policy* — the change
           * event names the plan that was clicked, and we read that as "show me only this
           * one" rather than as "hide this one".
           *
           * Isolating by filtering the rows, rather than by letting the legend hide the
           * series, is deliberate: the legend filters after the scales are resolved, so a
           * ₫260k plan would keep being drawn against a ₫7mil axis and stay invisible.
           * Feeding the mark only the rows we want re-scales the axis to them.
           */
          legend: interactiveColorLegend<number>({
            visible: controlledSignal<readonly number[], InteractiveColorLegendChange<number>>(
              only === null ? billed.map(({ sub }) => sub.id) : [only],
              (_next, { reason }) => {
                setOnly((current) => (current === reason.value ? null : reason.value));
              },
            ),
            // Under the plot, where a key belongs and where the tooltip — which anchors to
            // the hovered column and opens upward — can never land on top of it.
            placement: "bottom",
            itemWidth: legendItemWidth(width),
            format: (id) => billed.find(({ sub }) => sub.id === id)?.sub.name ?? String(id),
            ariaLabel: "Show one subscription",
            itemAriaLabel: (id, { visible }) => {
              const name = billed.find(({ sub }) => sub.id === id)?.sub.name ?? String(id);
              return visible && only !== null ? `Show every plan` : `Show only ${name}`;
            },
          }),
        },
        theme: CHART_THEME,
        // Same story as the deployed-by-month stack: isolating a plan from the legend
        // re-stacks the columns and rescales the axis under them, and tweening is what makes
        // that one movement rather than two unrelated pictures. Keyed on month + plan id.
        svgAnimation: CHART_MOTION,
        // Hovering anywhere in a column means the whole column: a stack is only readable if
        // you can see every plan that adds up to the height at once.
        focus: "group-x",
        focusRing: false,
        tooltip: {
          use: tooltip,
          anchor: "group-center",
          placement: ["top", "right", "left", "bottom"],
          // Rows in the colour scale's order, which is the stacking order — the tooltip
          // lists a column's plans the same way the column stacks them.
          sort: "color-domain",
          // The built-in tooltip renders the surface, the heading and one swatched row per
          // plan; all we supply is the wording.
          content: (points) => {
            const first = points[0]?.datum;
            if (!first) return { rows: [] };
            return {
              // The month's total belongs in the heading: it's the figure the column height
              // means, and the rows beneath it are what add up to it. Isolated, the column
              // height *is* the row below, so the month's full commitment would be a number
              // the chart isn't showing — the date alone is honest.
              title:
                only === null ? `${first.full} · ${fmtVND(first.total)}` : first.full,
              rows: points.map((point) => ({
                label: point.datum.sub.name,
                value: fmtVND(point.datum.amount),
                color: point.color,
              })),
            };
          },
        },
      }),
    [shown, months, billed, only, width],
  );

  const metrics = legendChartMetrics(billed.length, width, band);

  return (
    <div className="card-surface panel-body">
      <PanelHead
        title="Committed spend, next 12 months"
        info="Every charge falling in each calendar month, split by subscription and including the current month in full — charges it has already taken as well as the ones still ahead. Cancelled plans bill nothing."
      />
      <ChipLegendStyle />
      <div
        className="mt-5"
        ref={(node) => {
          measure(node);
          watchLegend(node);
        }}
      >
        <Chart
          definition={definition}
          height={metrics.height}
          initialWidth={INITIAL_PANEL_WIDTH}
          className={cn("w-full", CHIP_LEGEND_CLASS)}
          style={{ ...CHART_HOST_STYLE, "--legend-chip": `${metrics.chip}px` } as React.CSSProperties}
          ariaLabel="Committed spend for each of the next twelve months, split by subscription"
        />
      </div>
    </div>
  );
}

export function SubscriptionsManager({
  subscriptions,
  today,
}: {
  subscriptions: Subscription[];
  /** The day every figure here is computed against, fixed by the server. A subscription
   *  accrues nothing by the second, so a date is enough — but it still can't be read from
   *  the client's clock, which may be in a different timezone (and so a different day) from
   *  the one the app keeps its books in. See `APP_TIMEZONE` in lib/db.ts. */
  today: string;
}) {
  const rows = React.useMemo<SubRow[]>(
    () =>
      subscriptions.map((sub) => {
        const next = nextRenewal(sub, today);
        return {
          sub,
          monthly: monthlyCost(sub),
          yearly: yearlyCost(sub),
          next,
          days: next ? daysUntil(next, today) : Number.POSITIVE_INFINITY,
          spent: spentToDate(sub, today),
          cancelled: sub.cancelled_date != null,
        };
      }),
    [subscriptions, today],
  );

  const columns = React.useMemo(() => makeColumns(today), [today]);

  const active = rows.filter((r) => !r.cancelled);
  const cancelled = rows.filter((r) => r.cancelled);
  const s = summarize(subscriptions, today);

  const soon = active
    .filter((r) => r.days <= SOON_DAYS)
    .sort((a, b) => a.days - b.days);
  const soonTotal = soon.reduce((a, r) => a + r.sub.amount, 0);

  // Stacked biggest-first, matching the table's default sort, so a column and the list
  // below it rank the same plans the same way.
  const forecast = React.useMemo(() => {
    const ordered = [...subscriptions].sort((a, b) => monthlyCost(b) - monthlyCost(a));
    const months = monthlyForecast(ordered, today, FORECAST_MONTHS);
    // Only plans that actually charge inside the window get a segment. A plan cancelled
    // last month bills nothing from here on, and an empty series would still claim a
    // colour and a legend entry.
    const billedIdx = ordered
      .map((_, i) => i)
      .filter((i) => months.some((m) => m.parts[i] > 0));
    const billed = billedIdx.map((i) => ({ sub: ordered[i], fill: seriesFill(ordered[i]) }));

    const segments: ForecastSegment[] = [];
    for (const m of months) {
      const [y, mo] = m.month.split("-").map(Number);
      let base = 0;
      for (const i of billedIdx) {
        const amount = m.parts[i];
        if (!amount) continue;
        segments.push({
          sub: ordered[i],
          month: m.month,
          full: `${MONTHS[mo - 1]} ${y}`,
          amount,
          total: m.total,
          base,
          top: base + amount,
        });
        base += amount;
      }
    }
    return { segments, billed, months: months.map((m) => m.month) };
  }, [subscriptions, today]);

  const nextUp = active.reduce<SubRow | null>(
    (best, r) => (best === null || r.days < best.days ? r : best),
    null,
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Subscriptions" actions={<AddSubscriptionDialog today={today} />}>
        Everything on a recurring charge — streaming, software, insurance, the gym. They
        aren&apos;t assets, so they stay out of net worth; what they commit you to is a rate
        of spend, quoted here per month and per year.
      </PageHeader>

      {soon.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning-border bg-warning-bg px-5 py-4">
          <CalendarClock className="mt-0.5 size-4 text-warning" />
          <div>
            <div className="text-[13.5px] font-semibold">
              {soon.length} renewal{soon.length > 1 ? "s" : ""} in the next {SOON_DAYS} days ·{" "}
              {fmtVND(soonTotal)}
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              {soon
                .map((r) => `${r.sub.name} ${r.days === 0 ? "today" : r.days === 1 ? "tomorrow" : `in ${r.days}d`}`)
                .join(" · ")}
            </div>
          </div>
        </div>
      )}

      {/* Only the monthly rate is washed: it's the figure that decides whether a plan stays.
          The yearly total is the same commitment on a longer ruler, and "spent so far" is
          history — neither is a second verdict. */}
      <SummaryCards
        stats={[
          {
            label: "Committed per month",
            value: fmtVND(s.monthly),
            sub: `${s.active} active${s.cancelled ? ` · ${s.cancelled} cancelled` : ""}`,
            tone: "loss",
          },
          { label: "Committed per year", value: fmtVND(s.yearly) },
          {
            label: "Next charge",
            value: nextUp?.next ?? "—",
            sub: nextUp
              ? `${nextUp.sub.name} · ${fmtVND(nextUp.sub.amount)}`
              : "Nothing scheduled",
          },
          { label: "Spent so far", value: fmtVND(s.spent), sub: "Cancelled plans included" },
        ]}
      />

      {forecast.billed.length > 0 && (
        <ForecastPanel
          segments={forecast.segments}
          months={forecast.months}
          billed={forecast.billed}
        />
      )}

      <p className="text-[12.5px] text-muted-foreground">
        Sorted by what each costs a month — the top of this list is where cancelling one
        actually changes something.
      </p>

      <div className="overflow-hidden card-surface panel-body">
        <DataTable
          columns={columns}
          data={active}
          initialSorting={[{ id: "monthly", desc: true }]}
          emptyMessage={
            cancelled.length > 0 ? "Nothing billing — every subscription is cancelled." : "No subscriptions yet."
          }
          storageKey="subscriptions"
        />
      </div>

      {/* A cancelled plan keeps what it cost you while it ran, which is the reason to cancel
          one rather than delete it. Sorted by that figure, and folded away by default. */}
      {cancelled.length > 0 && (
        <details className="overflow-hidden card-surface">
          <summary className="cursor-pointer list-none px-[18px] py-3.5 text-[13px] font-semibold">
            Cancelled · {cancelled.length} subscription{cancelled.length > 1 ? "s" : ""} ·{" "}
            <span className="font-normal text-muted-foreground">
              {fmtVND(cancelled.reduce((a, r) => a + r.spent, 0))} spent · {fmtVND(cancelled.reduce((a, r) => a + r.monthly, 0))}/mo saved
            </span>
          </summary>
          <div className="border-t border-divider-soft panel-body">
            <DataTable
              columns={columns}
              data={cancelled}
              initialSorting={[{ id: "spent", desc: true }]}
              emptyMessage=""
              storageKey="subscriptions-cancelled"
            />
          </div>
        </details>
      )}
    </div>
  );
}
