"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCheck, Pencil, Plus, RotateCcw, TriangleAlert, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  DEBT_KINDS, INTEREST_TYPES, type Debt, type DebtKind, type DebtPayment,
} from "@/lib/types";
import {
  addDebt, addDebtPayment, archiveDebt, deleteDebt, deleteDebtPayment, updateDebt,
  updateDebtPayment,
} from "@/app/actions";
import { cn } from "@/lib/utils";
import { fmtVND } from "@/lib/format";
import {
  debtOwed, isMatured, isRevolving, maturityDate, maturityValue, paidThisMonth,
} from "@/lib/savings";
import { ValueOverTime, buildDailySeries } from "@/components/value-over-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/tooltip";
import { DataTable } from "@/components/data-table";
import { SummaryCards } from "@/components/stat-card";
import { PageHeader } from "@/components/page-header";
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
  /** What's still outstanding — always 0 once settled. `debtOwed` on a `fixed` loan keeps
   *  accruing toward maturity however much you've repaid, so without this a debt you'd
   *  closed would climb back out of zero the next day. Settling it is what says stop. */
  owed: number;
  paid: number;
  maturityMs: number;
  isCredit: boolean;
  settled: boolean;
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
      <DialogTrigger render={<Button />}>
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

function PaymentDialog({
  debt,
  payments,
  owed,
}: {
  debt: Debt;
  payments: DebtPayment[];
  /** Outstanding balance, computed once by the page against its fixed clock. Recomputing
   *  it here from `new Date()` would read a hair further into the interest than the row
   *  beside it — and "pay it all off" has to mean the figure you were shown. */
  owed: number;
}) {
  const [pending, startTransition] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);
  const today = new Date().toLocaleDateString("sv-SE");
  // Filling the amount field means replacing state that `CurrencyInput` owns, and it has
  // no controlled mode — so the fill is a remount with a new starting value. `seq` is why
  // a second click works: keyed on the amount alone, clicking "pay it all off", typing
  // something else and clicking again would leave what you typed sitting there.
  const [fill, setFill] = React.useState<{ seq: number; amount: number } | null>(null);

  const totalPaid = payments.reduce((a, p) => a + p.amount, 0);
  // What it takes to be *free* of the debt — which for a `fixed` loan is not the balance
  // on screen. Its interest accrues on the original principal all the way to maturity no
  // matter when you pay, so clearing today's figure leaves the rest of the term's interest
  // still to come, and the balance climbs again tomorrow. The payoff is the full term
  // value less what you've already handed over. Flexible and credit balances are already
  // the real thing: pay them and they stay at zero.
  const payoffTotal = debt.kind === "fixed" ? maturityValue(debt) : owed;
  const payoff = Math.max(0, Math.round(debt.kind === "fixed" ? payoffTotal - totalPaid : payoffTotal));
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
            Currently owed {fmtVND(owed)} · paid so far {fmtVND(totalPaid)}
            {debt.kind === "credit" && debt.monthly_payment
              ? ` · monthly ${fmtVND(debt.monthly_payment)}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          action={(fd) =>
            run(() => addDebtPayment(debt.id, fd), () => {
              setFill(null); // otherwise the next payment opens pre-filled with the old payoff
              formRef.current?.reset();
            })
          }
          className="grid gap-3 sm:grid-cols-2"
        >
          <div className="grid gap-2">
            <Label htmlFor={`p-date-${debt.id}`}>Date</Label>
            <Input id={`p-date-${debt.id}`} name="date" type="date" defaultValue={today} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`p-amount-${debt.id}`}>Amount paid (VND)</Label>
            <CurrencyInput
              key={fill?.seq ?? "typed"}
              id={`p-amount-${debt.id}`}
              name="amount"
              defaultValue={
                fill?.amount ??
                (debt.kind === "credit" ? debt.monthly_payment ?? undefined : undefined)
              }
              placeholder="5.000.000"
              required
            />
            {/* Under the field, not beside the label — sharing that row wrapped "Amount
                paid (VND)" onto two lines at every width the dialog is ever shown at. */}
            {payoff > 0 && (
              <button
                type="button"
                className="justify-self-start text-[12px] font-medium text-accent-brand hover:underline"
                title={
                  debt.kind === "fixed"
                    ? "The full term's value, less what you've paid. A fixed loan charges its interest to maturity whether you clear it early or not, so paying only the balance shown leaves the rest still to come."
                    : "Clears the outstanding balance in full."
                }
                onClick={() => setFill((f) => ({ seq: (f?.seq ?? 0) + 1, amount: payoff }))}
              >
                Pay it all off — {fmtVND(payoff)}
              </button>
            )}
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
  // Kind is a tag; "Settled" and "Due" are states the loan has reached, so they take the pill.
  if (d.archived === 1) return <Badge variant="accent">Settled</Badge>;
  if (isMatured(d)) return <Badge variant="secondary">Due</Badge>;
  if (d.kind === "credit") return <Badge variant="tag">Credit</Badge>;
  return <Badge variant="tag">{d.kind === "flexible" ? "Flexible" : "Fixed"}</Badge>;
}

/** Close a paid-off debt, or reopen one. Prominent the moment there's nothing left to pay:
 *  that's when you want it, and it's the only thing that stops a `fixed` loan quietly
 *  accruing its way back out of zero. */
function SettleDebtButton({ debt, cleared }: { debt: Debt; cleared: boolean }) {
  const [pending, startTransition] = React.useTransition();
  const settled = debt.archived === 1;
  return (
    <IconTooltip label={settled ? "Reopen debt" : cleared ? "Mark settled — nothing left to pay" : "Mark settled"}>
      <Button
        variant={cleared && !settled ? "outline" : "ghost"}
        size="icon-sm"
        aria-label={settled ? "Reopen debt" : "Mark settled"}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await archiveDebt(debt.id, !settled);
            if (res.ok) toast.success(res.message);
            else toast.error(res.message);
          })
        }
      >
        {settled ? <RotateCcw className="size-3.5" /> : <CheckCheck className={cn("size-3.5", cleared && "text-accent-brand")} />}
      </Button>
    </IconTooltip>
  );
}

const columns: ColumnDef<DebtRow>[] = [
  {
    id: "debt",
    header: "Debt",
    enableSorting: false,
    size: 180,
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
      // Nothing outstanding isn't a liability, so it loses the red.
      <span className={cn(
        "font-mono font-medium tabular-nums",
        row.original.owed > 0 ? "text-(--chart-negative)" : "text-muted-foreground",
      )}>
        {fmtVND(row.original.owed)}
      </span>
    ),
  },
  {
    id: "paid",
    header: "Paid",
    accessorFn: (r) => r.paid,
    size: 120,
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
    size: 160,
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
    size: 150,
    cell: ({ row }) => (
      <div className="flex justify-end gap-1">
        <PaymentDialog
          debt={row.original.debt}
          payments={row.original.payments}
          owed={row.original.owed}
        />
        <SettleDebtButton
          debt={row.original.debt}
          cleared={row.original.owed === 0 && row.original.paid > 0}
        />
        <EditDebtDialog debt={row.original.debt} />
        <DeleteDebtButton debt={row.original.debt} />
      </div>
    ),
  },
];

export function DebtsManager({
  debts,
  payments,
  nowMs,
}: {
  debts: Debt[];
  payments: DebtPayment[];
  /** The instant every figure on this page is computed against, fixed by the server.
   *  Debt interest accrues by the second, so letting the client read its own clock made
   *  hydration disagree with the server render by a rounding step — a real React hydration
   *  error on every load. See the note on `buildDailySeries`. */
  nowMs: number;
}) {
  const now = React.useMemo(() => new Date(nowMs), [nowMs]);
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
        const settled = debt.archived === 1;
        return {
          debt,
          payments: pmts,
          owed: settled ? 0 : debtOwed(debt, pmts, now),
          paid: pmts.reduce((a, p) => a + p.amount, 0),
          maturityMs: isRevolving(debt)
            ? Number.POSITIVE_INFINITY
            : Date.parse(maturityDate(debt) + "T00:00:00Z"),
          isCredit: debt.kind === "credit",
          settled,
          paidThisMonth: paidThisMonth(pmts, now),
        };
      }),
    [debts, byDebt, now],
  );

  const active = rows.filter((r) => !r.settled);
  const settled = rows.filter((r) => r.settled);

  // Totals stay over every debt, settled included. A settled one owes 0, so it can't move
  // "Currently owed" — but its repayments are still money you paid, and the interest it
  // cost you (`paid − principal`, what the third tile sums) is the whole point of keeping it.
  const owedSum = rows.reduce((a, r) => a + r.owed, 0);
  const paidSum = rows.reduce((a, r) => a + r.paid, 0);
  const principalSum = debts.reduce((a, d) => a + d.principal, 0);
  const interest = owedSum + paidSum - principalSum;
  // `owed > 0` is the fix for a nag that never stopped: the check only ever asked whether
  // you'd paid *this month*, so a card you cleared last year was flagged every month after.
  const dueThisMonth = active.filter((r) => r.isCredit && r.owed > 0 && !r.paidThisMonth);

  // Baseline is the interest-free balance — what you borrowed, less what you've repaid by
  // that date — so the band above it is the interest still sitting in the balance. Lifetime
  // interest (`owed + paid - principal`, the figure the summary tile quotes) is higher once
  // repayments have carried some of it back out, so it is tracked separately.
  //
  // A settled debt keeps its history and ends on the day you settled it. It can't simply be
  // handed to `debtOwed` like a live one: on a `fixed` loan the balance accrues toward
  // maturity however much you've repaid, so a closed loan left to its own maths climbs back
  // out of zero for the rest of the chart. Past its end date it is worth nothing — which is
  // both true and what makes the years before it safe to draw. A debt settled before
  // `settled_date` existed, with no repayment to date it from, has no known end and is left
  // out, exactly as every settled debt used to be.
  const charted = rows
    .map((r) => ({
      debt: r.debt,
      endMs: !r.settled
        ? Number.POSITIVE_INFINITY
        : Date.parse((r.debt.settled_date ?? r.payments.at(-1)?.date ?? "") + "T00:00:00Z"),
    }))
    .filter((c) => !Number.isNaN(c.endMs));
  const endOf = new Map(charted.map((c) => [c.debt.id, c.endMs]));
  const isOver = (debt: Debt, at: Date) => at.getTime() > (endOf.get(debt.id) ?? Number.POSITIVE_INFINITY);

  const series = buildDailySeries(
    charted.map((c) => c.debt),
    (debt, at) => (isOver(debt, at) ? 0 : debtOwed(debt, byDebt.get(debt.id) ?? [], at)),
    (debt, at) => {
      if (isOver(debt, at)) return { base: 0, interest: 0 };
      const pmts = byDebt.get(debt.id) ?? [];
      const paid = pmts
        .filter((p) => Date.parse(p.date + "T00:00:00Z") <= at.getTime())
        .reduce((a, p) => a + p.amount, 0);
      return {
        base: Math.max(0, debt.principal - paid),
        interest: debtOwed(debt, pmts, at) + paid - debt.principal,
      };
    },
    nowMs,
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Debts" actions={<AddDebtDialog />}>
        Loans and credit accounts. <span className="italic">Fixed</span> charges interest on
        the original amount, <span className="italic">Flexible</span> recomputes on the
        remaining balance, and <span className="italic">Credit</span>{" "}
        {/* The explicit space is load-bearing: an `&apos;` further down splits this into
            two JSX text nodes, and the split eats the space that opened the first one. */}
        flags any card you haven’t paid this month. Record repayments with the wallet
        button.
      </PageHeader>

      {dueThisMonth.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-warning-border bg-warning-bg px-5 py-4">
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
          bandFill="rgb(var(--negative-rgb) / 0.38)"
          tipLabel="Owed"
          baseLabel="Remaining principal"
          bandLabel="Interest"
          emptyMessage="No debt history yet."
        />
      )}

      {/* "Add debt" moved up to the page header — the design keeps one create button per
          view, beside the title. */}
      <p className="text-[12.5px] text-muted-foreground">
        Sorted by interest rate — tackle the highest-rate debts first.
      </p>

      <div className="overflow-hidden card-surface panel-body">
        <DataTable
          columns={columns}
          data={active}
          initialSorting={[{ id: "rate", desc: true }]}
          emptyMessage={settled.length > 0 ? "Nothing outstanding — every debt is settled." : "No debts yet."}
          storageKey="debts"
        />
      </div>

      {/* Settled debts keep their repayment history, which is the reason to close one
          rather than delete it. Sorted by what you paid, and folded away by default. */}
      {settled.length > 0 && (
        <details className="overflow-hidden card-surface">
          <summary className="cursor-pointer list-none px-[18px] py-3.5 text-[13px] font-semibold">
            Settled · {settled.length} debt{settled.length > 1 ? "s" : ""} ·{" "}
            <span className="font-normal text-muted-foreground">
              {fmtVND(settled.reduce((a, r) => a + r.paid, 0))} repaid
            </span>
          </summary>
          <div className="border-t border-divider-soft panel-body">
            <DataTable
              columns={columns}
              data={settled}
              initialSorting={[{ id: "paid", desc: true }]}
              emptyMessage=""
              storageKey="debts-settled"
            />
          </div>
        </details>
      )}
    </div>
  );
}
