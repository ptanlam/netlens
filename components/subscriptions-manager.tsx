"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ban, CalendarClock, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
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
 *  "Other" is deliberately absent — it takes `EntityAvatar`'s neutral tile. */
const CATEGORY_COLORS: Record<string, string> = {
  Entertainment: "var(--chart-5)",
  Software: "var(--chart-1)",
  Utilities: "var(--chart-3)",
  Health: "var(--chart-4)",
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

const chartConfig: ChartConfig = {
  total: { label: "Billed", color: "var(--chart-2)" },
};

interface ForecastBar {
  month: string;
  total: number;
  /** Axis tick — "Aug". */
  label: string;
  /** Tooltip heading — "Aug 2027", since the window crosses a year boundary. */
  full: string;
}

/**
 * What the next twelve months bill, month by month.
 *
 * The point of the panel is the lumps. A ₫/month figure spreads an annual renewal evenly
 * across the year, which is exactly the month you'd want warning about — here it stands up
 * as a bar three times its neighbours'.
 */
function ForecastPanel({ bars }: { bars: ForecastBar[] }) {
  return (
    <div className="card-surface panel-body">
      <PanelHead
        title="Committed spend, next 12 months"
        info="Every charge falling in each calendar month, including the current month in full — charges it has already taken as well as the ones still ahead. Cancelled plans bill nothing."
      />
      <div className="mt-5">
        <ChartContainer config={chartConfig} className="aspect-[3/1] min-h-48 w-full">
          <BarChart data={bars} accessibilityLayer>
            <CartesianGrid vertical={false} strokeWidth={1} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={fmtMil} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_v, p) => (p?.[0]?.payload as ForecastBar | undefined)?.full ?? ""}
                  formatter={(v) => (
                    <div className="flex w-full items-center gap-2">
                      <span className="text-muted-foreground">Billed</span>
                      <span className="ml-auto font-mono font-medium tabular-nums text-(--chart-negative)">
                        {fmtVND(Number(v))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Bar
              dataKey="total"
              fill="var(--color-total)"
              radius={[6, 6, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
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

  const bars = React.useMemo<ForecastBar[]>(
    () =>
      monthlyForecast(subscriptions, today, FORECAST_MONTHS).map((f) => {
        const [y, m] = f.month.split("-").map(Number);
        return { ...f, label: MONTHS[m - 1], full: `${MONTHS[m - 1]} ${y}` };
      }),
    [subscriptions, today],
  );

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

      {subscriptions.length > 0 && <ForecastPanel bars={bars} />}

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
