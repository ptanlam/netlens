"use client";

import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { INTEREST_TYPES, type Saving } from "@/lib/types";
import { addSaving, deleteSaving, updateSaving } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { currentValue, isMatured, maturityDate, maturityValue, summarize } from "@/lib/savings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

function SavingForm({
  action,
  saving,
  onDone,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  saving?: Saving;
  onDone?: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
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
        <Input
          id="s-principal"
          name="principal"
          type="number"
          min="1"
          step="1"
          defaultValue={saving?.principal}
          placeholder="100000000"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="s-rate">Interest rate (% / year)</Label>
        <Input
          id="s-rate"
          name="rate"
          type="number"
          min="0"
          step="0.01"
          defaultValue={saving?.rate}
          placeholder="6.5"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="s-term">Term (months)</Label>
        <Input
          id="s-term"
          name="term_months"
          type="number"
          min="1"
          step="1"
          defaultValue={saving?.term_months}
          placeholder="12"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="s-start">Deposit date</Label>
        <Input
          id="s-start"
          name="start_date"
          type="date"
          defaultValue={saving?.start_date ?? today}
          required
        />
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
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="s-note">Note (optional)</Label>
        <Input id="s-note" name="note" defaultValue={saving?.note ?? undefined} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : saving ? "Update deposit" : "Add deposit"}
        </Button>
      </div>
    </form>
  );
}

function SavingRow({ saving }: { saving: Saving }) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const matured = isMatured(saving);
  const cur = currentValue(saving);
  const matVal = maturityValue(saving);
  const interest = cur - saving.principal;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <div className="min-w-40 flex-1">
        <div className="flex items-center gap-2 font-medium">
          {saving.bank ?? "Term deposit"}
          <Badge variant={matured ? "secondary" : "outline"}>
            {matured ? "Matured" : "Active"}
          </Badge>
        </div>
        <div className="text-sm text-muted-foreground">
          {fmtVND(saving.principal)} · {saving.rate}%/yr · {saving.term_months}mo ·{" "}
          {saving.start_date} → {maturityDate(saving)}
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono font-medium tabular-nums">{fmtVND(cur)}</div>
        <div className="text-sm text-muted-foreground tabular-nums">
          <span className={interest >= 0 ? "text-(--chart-positive)" : "text-(--chart-negative)"}>
            {interest >= 0 ? "+" : ""}{fmtVND(interest)}
          </span>{" "}
          · at maturity {fmtVND(matVal)}
        </div>
      </div>
      <div className="flex gap-1">
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Edit deposit" />}
          >
            <Pencil className="size-3.5" />
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Edit deposit</DialogTitle>
            </DialogHeader>
            <SavingForm
              action={(fd) => updateSaving(saving.id, fd)}
              saving={saving}
              onDone={() => setEditOpen(false)}
            />
          </DialogContent>
        </Dialog>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete deposit"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Delete the ${fmtVND(saving.principal)} deposit${saving.bank ? ` at ${saving.bank}` : ""}?`))
              return;
            startTransition(async () => {
              const res = await deleteSaving(saving.id);
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

export function SavingsManager({ savings }: { savings: Saving[] }) {
  const s = summarize(savings);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent>
            <div className="text-sm text-muted-foreground">Total principal</div>
            <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
              {fmtVND(s.principal)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-sm text-muted-foreground">Current est. value</div>
            <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
              {fmtVND(s.currentValue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-sm text-muted-foreground">Est. interest earned</div>
            <div
              className={
                "mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl " +
                (s.interest >= 0 ? "text-(--chart-positive)" : "text-(--chart-negative)")
              }
            >
              {s.interest >= 0 ? "+" : ""}{fmtVND(s.interest)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        {savings.length === 0 && (
          <p className="text-sm text-muted-foreground">No deposits yet.</p>
        )}
        {savings.map((saving) => (
          <SavingRow key={saving.id} saving={saving} />
        ))}
      </div>

      <Separator className="my-1" />
      <div>
        <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium">
          <Plus className="size-3.5" /> New deposit
        </h3>
        <SavingForm action={addSaving} />
      </div>
    </div>
  );
}
