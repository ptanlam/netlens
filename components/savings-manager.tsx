"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, ArrowDownUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { INTEREST_TYPES, TERM_UNITS, type Saving, type TermUnit, type SavingMovement } from "@/lib/types";
import {
  addSaving, addSavingMovement, archiveSaving, deleteSaving, deleteSavingMovement, updateSaving,
} from "@/app/actions";
import { cn } from "@/lib/utils";
import { fmtTerm, fmtVND } from "@/lib/format";
import { currentValue, isMatured, maturityDate, maturityValue, netPrincipal, summarize } from "@/lib/savings";
import { ValueOverTime, buildDailySeries } from "@/components/value-over-time";
import { DataTable } from "@/components/data-table";
import { EntityAvatar } from "@/components/entity-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SummaryCards } from "@/components/stat-card";
import { PageHeader } from "@/components/page-header";
import { Amt } from "@/components/amt";

type ActionResult = { ok: boolean; message: string };

/** A sinking-fund goal a deposit can be earmarked for. */
export type FundOption = { id: number; name: string };

/** The "no goal" option. Base UI's Select needs a real value, and "" round-trips through
 *  FormData as null (`num("")` → null), which is exactly what an un-earmarked deposit is. */
const NO_GOAL = "";

const TERM_UNIT_LABELS: Record<TermUnit, string> = { day: "Days", week: "Weeks", month: "Months", year: "Years" };

function SavingForm({
  action,
  saving,
  funds,
  onDone,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  saving?: Saving;
  /** Sinking-fund goals a deposit can be earmarked for. */
  funds: FundOption[];
  onDone?: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [goalId, setGoalId] = React.useState(String(saving?.goal_id ?? NO_GOAL));
  const formRef = React.useRef<HTMLFormElement>(null);
  const today = new Date().toLocaleDateString("sv-SE");
  const goalLabel = funds.find((f) => String(f.id) === goalId)?.name ?? "Not earmarked";

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          const res = await action(fd);
          if (res.ok) {
            toast.success(res.message);
            if (!saving) formRef.current?.reset();
            onDone?.();
          } else toast.error(res.message);
        })
      }
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="grid gap-2">
        <Label htmlFor="s-bank">Bank / label (optional)</Label>
        <Input id="s-bank" name="bank" defaultValue={saving?.bank ?? undefined} placeholder="e.g. Techcombank" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="s-principal">Principal (VND)</Label>
        <CurrencyInput id="s-principal" name="principal" defaultValue={saving?.principal} placeholder="100.000.000" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="s-rate">Interest rate (% / year)</Label>
        <Input id="s-rate" name="rate" type="number" min="0" step="0.01" defaultValue={saving?.rate} placeholder="6.5" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="s-term">Term</Label>
        <div className="flex gap-2">
          <Input id="s-term" name="term_months" type="number" min="1" step="1" defaultValue={saving?.term_months} placeholder="12" required />
          <Select name="term_unit" defaultValue={saving?.term_unit ?? "month"} items={TERM_UNIT_LABELS}>
            <SelectTrigger aria-label="Term unit" className="w-32 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TERM_UNITS.map((u) => (
                <SelectItem key={u} value={u}>
                  {TERM_UNIT_LABELS[u]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="s-start">Deposit date</Label>
        <Input id="s-start" name="start_date" type="date" defaultValue={saving?.start_date ?? today} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="s-interest">Interest type</Label>
        <Select name="interest_type" defaultValue={saving?.interest_type ?? "simple"}>
          <SelectTrigger id="s-interest" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INTEREST_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t === "simple" ? "Simple (paid at maturity)" : "Compound (monthly)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {funds.length > 0 && (
        <div className="grid gap-2">
          <Label htmlFor="s-goal">Earmark for (optional)</Label>
          <Select name="goal_id" value={goalId} onValueChange={(v) => setGoalId(v ?? NO_GOAL)}>
            <SelectTrigger id="s-goal" className="w-full">
              <SelectValue>{goalLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_GOAL}>Not earmarked</SelectItem>
              {funds.map((f) => (
                <SelectItem key={f.id} value={String(f.id)}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="s-note">Note (optional)</Label>
        <Input id="s-note" name="note" defaultValue={saving?.note ?? undefined} />
      </div>
      {funds.length > 0 && (
        <p className="text-caption text-muted-foreground sm:col-span-2">
          An earmarked deposit still counts once — here, under Savings. It also fills the
          fund it&apos;s tied to, and is left out of net-worth goals, since it&apos;s
          already spoken for.
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : saving ? "Update deposit" : "Add deposit"}
        </Button>
      </div>
    </form>
  );
}

function AddDepositDialog({ funds }: { funds: FundOption[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="size-3.5" />
        New deposit
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New deposit</DialogTitle>
        </DialogHeader>
        <SavingForm action={addSaving} funds={funds} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Top-ups and withdrawals on one deposit: the form, and the history under it. */
function MovementsDialog({ saving, held }: { saving: Saving; held: number }) {
  const [pending, startTransition] = React.useTransition();
  const [kind, setKind] = React.useState<"withdraw" | "topup">("withdraw");
  const formRef = React.useRef<HTMLFormElement>(null);
  const today = new Date().toLocaleDateString("sv-SE");
  const history = [...saving.movements].reverse();
  const label = saving.bank ?? "Term deposit";

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message);
        after?.();
      } else toast.error(res.message);
    });

  return (
    <Dialog>
      <IconTooltip label="Withdraw or top up">
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Withdraw or top up" />}>
          <ArrowDownUp className="size-3.5" />
        </DialogTrigger>
      </IconTooltip>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Withdraw or top up — {label}</DialogTitle>
          <DialogDescription>
            Holds <Amt>{fmtVND(Math.round(held))}</Amt>{" "}today. Money you take out stops earning the
            day it leaves; a top-up earns the deposit&apos;s rate from the day it lands.
          </DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          action={(fd) => run(() => addSavingMovement(saving.id, fd), () => formRef.current?.reset())}
          className="grid gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="kind" value={kind} />
          <div className="flex gap-0.5 justify-self-start rounded-full bg-pane p-1 sm:col-span-2">
            {(["withdraw", "topup"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-body-sm font-semibold transition-colors",
                  kind === k ? "bg-card text-foreground shadow-[0_1px_3px_rgb(14_15_12/0.14)] dark:bg-pane-2" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k === "withdraw" ? "Withdraw" : "Top up"}
              </button>
            ))}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`m-date-${saving.id}`}>Date</Label>
            <Input id={`m-date-${saving.id}`} name="date" type="date" defaultValue={today} min={saving.start_date} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`m-amount-${saving.id}`}>Amount (VND)</Label>
            <CurrencyInput id={`m-amount-${saving.id}`} name="amount" placeholder="5.000.000" required />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={`m-note-${saving.id}`}>Note (optional)</Label>
            <Input id={`m-note-${saving.id}`} name="note" />
          </div>
          <Button type="submit" disabled={pending} className="sm:col-span-2">
            {pending ? "Saving…" : kind === "withdraw" ? "Record withdrawal" : "Record top-up"}
          </Button>
        </form>

        {history.length > 0 && (
          <div className="mt-2">
            <div className="mb-1 text-caption text-muted-foreground">History</div>
            {history.map((m) => (
              <MovementRow key={m.id} movement={m} pending={pending} onDelete={() => run(() => deleteSavingMovement(m.id))} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MovementRow({ movement, pending, onDelete }: { movement: SavingMovement; pending: boolean; onDelete: () => void }) {
  const out = movement.amount < 0;
  return (
    <div className="flex items-center gap-3 border-b py-1.5 text-body-sm last:border-0">
      <span className="tabular-nums text-muted-foreground">{movement.date}</span>
      <span data-amount className={cn("font-mono font-semibold tabular-nums", out ? "text-destructive" : "text-accent-brand")}>
        {out ? "−" : "+"}{fmtVND(Math.abs(movement.amount))}
      </span>
      <span className="flex-1 truncate text-muted-foreground">{movement.note}</span>
      <IconTooltip label={out ? "Delete withdrawal" : "Delete top-up"}>
        <Button variant="ghost" size="icon-sm" aria-label="Delete movement" disabled={pending} onClick={onDelete}>
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </IconTooltip>
    </div>
  );
}

/** The day an archived deposit stopped counting. */
function endOf(d: Saving): Date {
  return new Date(`${d.archived_date}T00:00:00Z`);
}

type SavingRow = {
  saving: Saving;
  archived: boolean;
  matured: boolean;
  cur: number;
  net: number;
  interest: number;
  matVal: number;
  maturityMs: number;
};

function SavingActions({ row, funds }: { row: SavingRow; funds: FundOption[] }) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const { saving, archived, matured, cur } = row;

  return (
    <div className="flex justify-end gap-1">
      {!archived && <MovementsDialog saving={saving} held={cur} />}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <IconTooltip label="Edit deposit">
          <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit deposit" />}>
            <Pencil className="size-3.5" />
          </DialogTrigger>
        </IconTooltip>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit deposit</DialogTitle>
          </DialogHeader>
          <SavingForm action={(fd) => updateSaving(saving.id, fd)} saving={saving} funds={funds} onDone={() => setEditOpen(false)} />
        </DialogContent>
      </Dialog>
      <IconTooltip label={archived ? "Restore deposit" : matured ? "Archive — matured and withdrawn" : "Archive deposit"}>
        <Button
          variant={matured && !archived ? "outline" : "ghost"}
          size="icon-sm"
          aria-label={archived ? "Restore deposit" : "Archive deposit"}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await archiveSaving(saving.id, !archived);
              if (res.ok) toast.success(res.message);
              else toast.error(res.message);
            })
          }
        >
          {archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
        </Button>
      </IconTooltip>
      <IconTooltip label="Delete deposit">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete deposit"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Delete the ${fmtVND(saving.principal)} deposit${saving.bank ? ` at ${saving.bank}` : ""}?`)) return;
            startTransition(async () => {
              const res = await deleteSaving(saving.id);
              if (res.ok) toast.success(res.message);
              else toast.error(res.message);
            });
          }}
        >
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </IconTooltip>
    </div>
  );
}

function makeColumns(funds: FundOption[]): ColumnDef<SavingRow>[] {
  return [
    {
      id: "deposit",
      header: "Deposit",
      accessorFn: (r) => r.saving.start_date,
      size: 200,
      cell: ({ row }) => {
        const { saving, archived, matured, net } = row.original;
        const earmarked = funds.find((f) => f.id === saving.goal_id);
        return (
          <div className="flex items-center gap-2">
            <EntityAvatar name={saving.bank ?? "Term deposit"} color="var(--chart-4)" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">{saving.bank ?? "Term deposit"}</span>
                {archived ? (
                  <Badge variant="secondary">Archived {saving.archived_date}</Badge>
                ) : (
                  matured && <Badge variant="secondary">Matured</Badge>
                )}
                {earmarked && <Badge variant="tag">For {earmarked.name}</Badge>}
              </div>
              <div className="text-caption text-muted-foreground">
                <Amt>{fmtVND(saving.principal)}</Amt>
                {saving.movements.length > 0 && <> → <Amt>{fmtVND(net)}</Amt> net</>} · {fmtTerm(saving.term_months, saving.term_unit)}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: "rate",
      header: "Rate",
      accessorFn: (r) => r.saving.rate,
      size: 80,
      meta: { align: "right" },
      cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.saving.rate}%</span>,
    },
    {
      id: "maturity",
      header: "Matures",
      accessorFn: (r) => r.maturityMs,
      size: 130,
      cell: ({ row }) => <span className="tabular-nums">{maturityDate(row.original.saving)}</span>,
    },
    {
      id: "value",
      header: "Value",
      accessorFn: (r) => r.cur,
      size: 140,
      meta: { align: "right" },
      cell: ({ row }) => (
        <span data-amount className="font-mono font-semibold tabular-nums">{fmtVND(row.original.cur)}</span>
      ),
    },
    {
      id: "interest",
      header: "Interest",
      accessorFn: (r) => r.interest,
      size: 120,
      meta: { align: "right" },
      cell: ({ row }) => {
        const i = row.original.interest;
        return (
          <span data-amount className={cn("font-mono tabular-nums", i >= 0 ? "text-accent-brand" : "text-destructive")}>
            {i >= 0 ? "+" : ""}{fmtVND(i)}
          </span>
        );
      },
    },
    {
      id: "atMaturity",
      header: "At maturity",
      accessorFn: (r) => r.matVal,
      size: 130,
      meta: { align: "right" },
      cell: ({ row }) => (
        <span data-amount className="font-mono tabular-nums text-muted-foreground">{fmtVND(row.original.matVal)}</span>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      size: 150,
      cell: ({ row }) => <SavingActions row={row.original} funds={funds} />,
    },
  ];
}

export function SavingsManager({
  savings,
  funds,
  nowMs,
}: {
  savings: Saving[];
  funds: FundOption[];
  /** Fixed by the server — deposits accrue by the second, so a client-read clock made the
   *  hydrated figures differ from the server's by a rounding step. Same as Debts. */
  nowMs: number;
}) {
  const now = React.useMemo(() => new Date(nowMs), [nowMs]);
  const open = savings.filter((d) => d.archived_date == null);
  // The tiles are what's at the bank now; the chart keeps an archived deposit up to the day
  // you took it out, and drops it after.
  const s = summarize(open, now);
  const columns = React.useMemo(() => makeColumns(funds), [funds]);
  const rows = React.useMemo<SavingRow[]>(
    () =>
      savings.map((saving) => {
        const archived = saving.archived_date != null;
        // An archived deposit is worth what it was the day you took it out.
        const at = archived ? endOf(saving) : now;
        const cur = currentValue(saving, at);
        const net = netPrincipal(saving, at);
        return {
          saving,
          archived,
          matured: isMatured(saving, now),
          cur,
          net,
          interest: cur - net,
          matVal: maturityValue(saving),
          maturityMs: Date.parse(maturityDate(saving) + "T00:00:00Z"),
        };
      }),
    [savings, now],
  );
  const active = rows.filter((r) => !r.archived);
  const inactive = rows.filter((r) => r.archived);
  const isOut = (d: Saving, at: Date) => d.archived_date != null && at > endOf(d);
  // Baseline is what you'd put in and not taken out by then, so the band is interest, and
  // every top-up and withdrawal shows as a step on the day it happened.
  const series = buildDailySeries(
    savings,
    (d, at) => (isOut(d, at) ? 0 : currentValue(d, at)),
    (d, at) => {
      if (isOut(d, at)) return { base: 0, interest: 0 };
      const base = netPrincipal(d, at);
      return { base, interest: currentValue(d, at) - base };
    },
    nowMs,
  );

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PageHeader title="Savings" actions={<AddDepositDialog funds={funds} />}>
        Term deposits — principal, annual rate, and term. Value accrues to maturity
        (simple pays at maturity; compound accrues monthly).
      </PageHeader>

      <SummaryCards
        stats={[
          { label: "Total principal", value: fmtVND(s.principal) },
          { label: "Current est. value", value: fmtVND(s.currentValue) },
          {
            label: "Est. interest earned",
            value: `${s.interest >= 0 ? "+" : ""}${fmtVND(s.interest)}`,
            tone: s.interest >= 0 ? "gain" : "loss",
          },
        ]}
      />

      {series.length > 1 && (
        <ValueOverTime
          title="Savings value over time"
          subtitle="Estimated total as deposits accrue interest toward maturity"
          series={series}
          stroke="var(--chart-positive)"
          areaFill="rgb(var(--positive-rgb) / 0.13)"
          bandFill="rgb(var(--positive-rgb) / 0.38)"
          tipLabel="Value"
          baseLabel="Principal"
          bandLabel="Interest"
          emptyMessage="No deposit history yet."
        />
      )}

      <div className="overflow-hidden card-surface panel-body">
        <DataTable
          columns={columns}
          data={active}
          initialSorting={[{ id: "deposit", desc: true }]}
          pageSize={10}
          emptyMessage="No deposits yet."
          storageKey="savings"
        />
      </div>

      {inactive.length > 0 && (
        <details className="overflow-hidden card-surface">
          <summary className="cursor-pointer list-none px-[18px] py-3.5 text-body-sm font-semibold">
            Archived · {inactive.length} deposit{inactive.length > 1 ? "s" : ""} ·{" "}
            <span className="font-normal text-muted-foreground">withdrawn, no longer counted in net worth</span>
          </summary>
          <div className="border-t border-divider-soft panel-body">
            <DataTable
              columns={columns}
              data={inactive}
              initialSorting={[{ id: "deposit", desc: true }]}
              pageSize={10}
              emptyMessage=""
              storageKey="savings-archived"
            />
          </div>
        </details>
      )}
    </div>
  );
}
