"use client";

import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { INTEREST_TYPES, type Debt } from "@/lib/types";
import { addDebt, deleteDebt, updateDebt } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { currentValue, isMatured, isRevolving, maturityDate, maturityValue, summarize } from "@/lib/savings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

type ActionResult = { ok: boolean; message: string };

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
  const [revolving, setRevolving] = React.useState(debt ? debt.term_months <= 0 : false);
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
              setRevolving(false);
            }
            onDone?.();
          } else toast.error(res.message);
        })
      }
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="grid gap-2">
        <Label htmlFor="d-lender">Lender / label (optional)</Label>
        <Input id="d-lender" name="lender" defaultValue={debt?.lender ?? undefined} placeholder="e.g. Visa credit card" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="d-principal">
          {revolving ? "Current balance (VND)" : "Principal (VND)"}
        </Label>
        <Input
          id="d-principal"
          name="principal"
          type="number"
          min="1"
          step="1"
          defaultValue={debt?.principal}
          placeholder="20000000"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="d-rate">Interest rate (% / year{revolving ? ", APR" : ""})</Label>
        <Input
          id="d-rate"
          name="rate"
          type="number"
          min="0"
          step="0.01"
          defaultValue={debt?.rate}
          placeholder={revolving ? "24" : "10"}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="d-term">Term (months)</Label>
        <Input
          id="d-term"
          name="term_months"
          type="number"
          min="1"
          step="1"
          defaultValue={debt?.term_months || undefined}
          placeholder={revolving ? "— revolving —" : "24"}
          disabled={revolving}
          required={!revolving}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="d-start">{revolving ? "Balance as of" : "Start date"}</Label>
        <Input
          id="d-start"
          name="start_date"
          type="date"
          defaultValue={debt?.start_date ?? today}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="d-interest">Interest type</Label>
        <Select name="interest_type" defaultValue={debt?.interest_type ?? "compound"}>
          <SelectTrigger id="d-interest" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INTEREST_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t === "simple" ? "Simple (due at term end)" : "Compound (monthly)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <Checkbox checked={revolving} onCheckedChange={(v) => setRevolving(v === true)} />
        {revolving && <input type="hidden" name="revolving" value="1" />}
        Revolving credit (credit card — no fixed term, interest compounds on the balance)
      </label>
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

function DebtRow({ debt }: { debt: Debt }) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const revolving = isRevolving(debt);
  const matured = isMatured(debt);
  const owed = currentValue(debt);
  const matVal = maturityValue(debt);
  const interest = owed - debt.principal;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <div className="min-w-40 flex-1">
        <div className="flex items-center gap-2 font-medium">
          {debt.lender ?? "Loan"}
          <Badge variant={revolving ? "outline" : matured ? "secondary" : "outline"}>
            {revolving ? "Revolving" : matured ? "Due" : "Active"}
          </Badge>
        </div>
        <div className="text-sm text-muted-foreground">
          {fmtVND(debt.principal)} · {debt.rate}%/yr ·{" "}
          {revolving
            ? `since ${debt.start_date}`
            : `${debt.term_months}mo · ${debt.start_date} → ${maturityDate(debt)}`}
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono font-medium tabular-nums text-(--chart-negative)">
          {fmtVND(owed)}
        </div>
        <div className="text-sm text-muted-foreground tabular-nums">
          +{fmtVND(interest)} interest
          {!revolving && ` · total due ${fmtVND(matVal)}`}
        </div>
      </div>
      <div className="flex gap-1">
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Edit debt" />}
          >
            <Pencil className="size-3.5" />
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Edit debt</DialogTitle>
            </DialogHeader>
            <DebtForm
              action={(fd) => updateDebt(debt.id, fd)}
              debt={debt}
              onDone={() => setEditOpen(false)}
            />
          </DialogContent>
        </Dialog>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete debt"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Delete the ${fmtVND(debt.principal)} debt${debt.lender ? ` (${debt.lender})` : ""}?`))
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
      </div>
    </div>
  );
}

export function DebtsManager({ debts }: { debts: Debt[] }) {
  const s = summarize(debts);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent>
            <div className="text-sm text-muted-foreground">Total borrowed</div>
            <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
              {fmtVND(s.principal)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-sm text-muted-foreground">Currently owed</div>
            <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums text-(--chart-negative) sm:text-2xl">
              {fmtVND(s.currentValue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-sm text-muted-foreground">Est. interest accrued</div>
            <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums text-(--chart-negative) sm:text-2xl">
              +{fmtVND(s.interest)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        {debts.length === 0 && (
          <p className="text-sm text-muted-foreground">No debts yet.</p>
        )}
        {debts.map((debt) => (
          <DebtRow key={debt.id} debt={debt} />
        ))}
      </div>

      <Separator className="my-1" />
      <div>
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium">
          <Plus className="size-3.5" /> New debt
        </h3>
        <DebtForm action={addDebt} />
      </div>
    </div>
  );
}
