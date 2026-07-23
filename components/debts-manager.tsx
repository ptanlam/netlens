"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Plus, TriangleAlert, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  DEBT_KINDS, INTEREST_TYPES, type Debt, type DebtKind, type DebtPayment,
} from "@/lib/types";
import {
  addDebt, addDebtPayment, deleteDebt, deleteDebtPayment, updateDebt, updateDebtPayment,
} from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { debtOwed, isMatured, isRevolving, maturityDate, paidThisMonth } from "@/lib/savings";
import { ValueOverTime, buildDailySeries } from "@/components/value-over-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/tooltip";
import { DataTable } from "@/components/data-table";
import { SummaryCards } from "@/components/stat-card";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

type ActionResult = { ok: boolean; message: string };

const KIND_LABEL: Record<DebtKind, string> = {
  fixed: "Fixed term (interest on the original amount)",
  flexible: "Flexible (interest on the remaining balance)",
  credit: "Credit (monthly payment required)",
};

interface DebtRow {
  debt: Debt;
  payments: DebtPayment[];
  owed: number;
  paid: number;
  maturityMs: number;
  isCredit: boolean;
  paidThisMonth: boolean;
}

function DebtForm({
  action,
  debt,
  onDone,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  debt?: Debt;
  onDone?: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [kind, setKind] = React.useState<DebtKind>(debt?.kind ?? "fixed");
  const credit = kind === "credit";
  const formRef = React.useRef<HTMLFormElement>(null);
  const today = new Date().toLocaleDateString("sv-SE");

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          const res = await action(fd);
          if (res.ok) {
            toast.success(res.message);
            if (!debt) {
              formRef.current?.reset();
              setKind("fixed");
            }
            onDone?.();
          } else toast.error(res.message);
        })
      }
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="d-kind">Debt type</Label>
        <Select name="kind" value={kind} onValueChange={(v) => v != null && setKind(v as DebtKind)}>
          <SelectTrigger id="d-kind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEBT_KINDS.map((k) => (
              <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="d-lender">Lender / label (optional)</Label>
        <Input id="d-lender" name="lender" defaultValue={debt?.lender ?? undefined} placeholder="e.g. Visa credit card" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="d-principal">{credit ? "Current balance (VND)" : "Principal (VND)"}</Label>
        <CurrencyInput
          id="d-principal"
          name="principal"
          defaultValue={debt?.principal}
          placeholder="20.000.000"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="d-rate">Interest rate (% / year{credit ? ", APR" : ""})</Label>
        <Input
          id="d-rate"
          name="rate"
          type="number"
          min="0"
          step="0.01"
          defaultValue={debt?.rate}
          placeholder={credit ? "24" : "10"}
          required
        />
      </div>
      {credit ? (
        <div className="grid gap-2">
          <Label htmlFor="d-monthly">Monthly payment (VND)</Label>
          <CurrencyInput
            id="d-monthly"
            name="monthly_payment"
            defaultValue={debt?.monthly_payment ?? undefined}
            placeholder="3.000.000"
            required
          />
        </div>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor="d-term">Term (months)</Label>
          <Input
            id="d-term"
            name="term_months"
            type="number"
            min="1"
            step="1"
            defaultValue={debt?.term_months || undefined}
            placeholder="24"
            required
          />
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="d-start">{credit ? "Balance as of" : "Start date"}</Label>
        <Input id="d-start" name="start_date" type="date" defaultValue={debt?.start_date ?? today} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="d-interest">Interest method</Label>
        <Select name="interest_type" defaultValue={debt?.interest_type ?? "compound"}>
          <SelectTrigger id="d-interest" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INTEREST_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t === "simple" ? "Simple" : "Compound (monthly)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="d-note">Note (optional)</Label>
        <Input id="d-note" name="note" defaultValue={debt?.note ?? undefined} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : debt ? "Update debt" : "Add debt"}
        </Button>
      </div>
    </form>
  );
}

function AddDebtDialog() {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-3.5" />
        Add debt
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add debt</DialogTitle>
        </DialogHeader>
        <DebtForm action={addDebt} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EditDebtDialog({ debt }: { debt: Debt }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <IconTooltip label="Edit debt">
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit debt" />}>
          <Pencil className="size-3.5" />
        </DialogTrigger>
      </IconTooltip>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit debt</DialogTitle>
        </DialogHeader>
        <DebtForm action={(fd) => updateDebt(debt.id, fd)} debt={debt} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PaymentRow({ payment }: { payment: DebtPayment }) {
  const [editing, setEditing] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message);
        after?.();
      } else toast.error(res.message);
    });

  if (editing) {
    return (
      <form
        action={(fd) => run(() => updateDebtPayment(payment.id, fd), () => setEditing(false))}
        className="flex flex-wrap items-center gap-2 border-b py-1.5 last:border-0"
      >
        <Input name="date" type="date" defaultValue={payment.date} className="h-8 w-[9.5rem]" required />
        <CurrencyInput name="amount" defaultValue={payment.amount} className="h-8 w-32" required />
        <Input name="note" defaultValue={payment.note ?? ""} placeholder="Note" className="h-8 min-w-24 flex-1" />
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-3 border-b py-1.5 text-sm last:border-0">
      <span className="tabular-nums text-muted-foreground">{payment.date}</span>
      <span className="font-mono font-medium tabular-nums text-(--chart-positive)">
        −{fmtVND(payment.amount)}
      </span>
      <span className="flex-1 truncate text-muted-foreground">{payment.note}</span>
      <IconTooltip label="Edit payment">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Edit payment"
          disabled={pending}
          onClick={() => setEditing(true)}
        >
          <Pencil className="size-3.5" />
        </Button>
      </IconTooltip>
      <IconTooltip label="Delete payment">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete payment"
          disabled={pending}
          onClick={() => run(() => deleteDebtPayment(payment.id))}
        >
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </IconTooltip>
    </div>
  );
}

function PaymentDialog({ debt, payments }: { debt: Debt; payments: DebtPayment[] }) {
  const [pending, startTransition] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);
  const today = new Date().toLocaleDateString("sv-SE");

  const currentlyOwed = debtOwed(debt, payments);
  const totalPaid = payments.reduce((a, p) => a + p.amount, 0);
  const history = [...payments].sort((a, b) => (a.date < b.date ? 1 : -1));

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
      <IconTooltip label="Record payment">
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Record payment" />}>
          <Wallet className="size-3.5" />
        </DialogTrigger>
      </IconTooltip>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Payments — {debt.lender ?? "Loan"}</DialogTitle>
          <DialogDescription>
            Currently owed {fmtVND(currentlyOwed)} · paid so far {fmtVND(totalPaid)}
            {debt.kind === "credit" && debt.monthly_payment
              ? ` · monthly ${fmtVND(debt.monthly_payment)}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          action={(fd) => run(() => addDebtPayment(debt.id, fd), () => formRef.current?.reset())}
          className="grid gap-3 sm:grid-cols-2"
        >
          <div className="grid gap-2">
            <Label htmlFor={`p-date-${debt.id}`}>Date</Label>
            <Input id={`p-date-${debt.id}`} name="date" type="date" defaultValue={today} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`p-amount-${debt.id}`}>Amount paid (VND)</Label>
            <CurrencyInput
              id={`p-amount-${debt.id}`}
              name="amount"
              defaultValue={debt.kind === "credit" ? debt.monthly_payment ?? undefined : undefined}
              placeholder="5.000.000"
              required
            />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={`p-note-${debt.id}`}>Note (optional)</Label>
            <Input id={`p-note-${debt.id}`} name="note" />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Record payment"}
            </Button>
          </div>
        </form>

        <Separator />

        <div className="max-h-64 overflow-y-auto">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            history.map((p) => <PaymentRow key={p.id} payment={p} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDebtButton({ debt }: { debt: Debt }) {
  const [pending, startTransition] = React.useTransition();
  return (
    <IconTooltip label="Delete debt">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete debt"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Delete the ${fmtVND(debt.principal)} debt${debt.lender ? ` (${debt.lender})` : ""}? Its payments are removed too.`))
            return;
          startTransition(async () => {
            const res = await deleteDebt(debt.id);
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

function typeBadge(d: Debt) {
  if (d.kind === "credit") return <Badge variant="outline">Credit</Badge>;
  if (isMatured(d)) return <Badge variant="secondary">Due</Badge>;
  return <Badge variant="outline">{d.kind === "flexible" ? "Flexible" : "Fixed"}</Badge>;
}

const columns: ColumnDef<DebtRow>[] = [
  {
    id: "debt",
    header: "Debt",
    enableSorting: false,
    size: 200,
    cell: ({ row }) => {
      const d = row.original.debt;
      return (
        <div>
          <div className="font-medium">{d.lender ?? "Loan"}</div>
          <div className="text-xs text-muted-foreground">
            {fmtVND(d.principal)} · {row.original.isCredit ? `since ${d.start_date}` : `${d.term_months}mo`}
          </div>
        </div>
      );
    },
  },
  {
    id: "rate",
    header: "Rate",
    accessorFn: (r) => r.debt.rate,
    size: 90,
    meta: { align: "right" },
    cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.debt.rate}%</span>,
  },
  {
    id: "kind",
    header: "Type",
    enableSorting: false,
    size: 100,
    cell: ({ row }) => typeBadge(row.original.debt),
  },
  {
    id: "due",
    header: "Due date",
    accessorFn: (r) => r.maturityMs,
    size: 130,
    cell: ({ row }) =>
      row.original.isCredit ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">{maturityDate(row.original.debt)}</span>
      ),
  },
  {
    id: "owed",
    header: "Owed",
    accessorFn: (r) => r.owed,
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="font-mono font-medium tabular-nums text-(--chart-negative)">
        {fmtVND(row.original.owed)}
      </span>
    ),
  },
  {
    id: "paid",
    header: "Paid",
    accessorFn: (r) => r.paid,
    size: 140,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="font-mono tabular-nums text-muted-foreground">
        {row.original.paid ? fmtVND(row.original.paid) : "—"}
      </span>
    ),
  },
  {
    id: "note",
    header: "Note",
    enableSorting: false,
    size: 200,
    cell: ({ row }) => (
      <span className="block max-w-40 truncate text-sm text-muted-foreground">
        {row.original.debt.note}
      </span>
    ),
  },
  {
    id: "actions",
    header: "",
    enableSorting: false,
    size: 130,
    cell: ({ row }) => (
      <div className="flex justify-end gap-1">
        <PaymentDialog debt={row.original.debt} payments={row.original.payments} />
        <EditDebtDialog debt={row.original.debt} />
        <DeleteDebtButton debt={row.original.debt} />
      </div>
    ),
  },
];

export function DebtsManager({
  debts,
  payments,
}: {
  debts: Debt[];
  payments: DebtPayment[];
}) {
  const byDebt = React.useMemo(() => {
    const m = new Map<number, DebtPayment[]>();
    for (const p of payments) {
      const list = m.get(p.debt_id) ?? [];
      list.push(p);
      m.set(p.debt_id, list);
    }
    return m;
  }, [payments]);

  const rows = React.useMemo<DebtRow[]>(
    () =>
      debts.map((debt) => {
        const pmts = byDebt.get(debt.id) ?? [];
        return {
          debt,
          payments: pmts,
          owed: debtOwed(debt, pmts),
          paid: pmts.reduce((a, p) => a + p.amount, 0),
          maturityMs: isRevolving(debt)
            ? Number.POSITIVE_INFINITY
            : Date.parse(maturityDate(debt) + "T00:00:00Z"),
          isCredit: debt.kind === "credit",
          paidThisMonth: paidThisMonth(pmts),
        };
      }),
    [debts, byDebt],
  );

  const owedSum = rows.reduce((a, r) => a + r.owed, 0);
  const paidSum = rows.reduce((a, r) => a + r.paid, 0);
  const principalSum = debts.reduce((a, d) => a + d.principal, 0);
  const interest = owedSum + paidSum - principalSum;
  const dueThisMonth = rows.filter((r) => r.isCredit && !r.paidThisMonth);

  const series = buildDailySeries(debts, (debt, at) => debtOwed(debt, byDebt.get(debt.id) ?? [], at));

  return (
    <div className="flex flex-col gap-4">
      {dueThisMonth.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-[10px] border border-warning-border bg-warning-bg px-[18px] py-3.5">
          <TriangleAlert className="mt-0.5 size-4 text-warning" />
          <div>
            <div className="text-[13.5px] font-semibold">
              {dueThisMonth.length} credit payment{dueThisMonth.length > 1 ? "s" : ""} due this month
            </div>
            <div className="mt-0.5 text-[12.5px] text-muted-foreground">
              Record this month&apos;s payment for {dueThisMonth.map((r) => r.debt.lender ?? "a credit account").join(", ")}
              {" "}to avoid a late mark on your credit score.
            </div>
          </div>
        </div>
      )}

      {/* "Total paid" is the one neutral figure here — it's progress, not a liability, so
          it stays unwashed between the two red tiles. */}
      <SummaryCards
        stats={[
          { label: "Currently owed", value: fmtVND(owedSum), tone: "loss" },
          { label: "Total paid", value: fmtVND(paidSum) },
          { label: "Est. interest accrued", value: `+${fmtVND(interest)}`, tone: "loss" },
        ]}
      />

      {series.length > 1 && (
        <ValueOverTime
          title="Debt owed over time"
          subtitle="Outstanding balance as interest accrues and payments post"
          series={series}
          stroke="var(--chart-negative)"
          areaFill="rgb(var(--negative-rgb) / 0.13)"
          tipLabel="Owed"
          emptyMessage="No debt history yet."
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted-foreground">
          Sorted by interest rate — tackle the highest-rate debts first.
        </p>
        <AddDebtDialog />
      </div>

      <div className="overflow-hidden card-surface px-4 py-2">
        <DataTable
          columns={columns}
          data={rows}
          initialSorting={[{ id: "rate", desc: true }]}
          emptyMessage="No debts yet."
          storageKey="debts"
        />
      </div>
    </div>
  );
}
