"use client";

import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { INTEREST_TYPES, type Saving } from "@/lib/types";
import { addSaving, deleteSaving, updateSaving } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { currentValue, isMatured, maturityDate, maturityValue, summarize } from "@/lib/savings";
import { ValueOverTime, buildDailySeries } from "@/components/value-over-time";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ActionResult = { ok: boolean; message: string };

/** A sinking-fund goal a deposit can be earmarked for. */
export type FundOption = { id: number; name: string };

/** The "no goal" option. Base UI's Select needs a real value, and "" round-trips through
 *  FormData as null (`num("")` → null), which is exactly what an un-earmarked deposit is. */
const NO_GOAL = "";

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
        <Label htmlFor="s-term">Term (months)</Label>
        <Input id="s-term" name="term_months" type="number" min="1" step="1" defaultValue={saving?.term_months} placeholder="12" required />
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
        <p className="text-[12px] text-muted-foreground sm:col-span-2">
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
      <DialogTrigger render={<Button size="sm" />}>
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

function SavingRow({ saving, funds }: { saving: Saving; funds: FundOption[] }) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const matured = isMatured(saving);
  const cur = currentValue(saving);
  const matVal = maturityValue(saving);
  const interest = cur - saving.principal;
  const earmarked = funds.find((f) => f.id === saving.goal_id);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 card-surface px-5 py-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-semibold">{saving.bank ?? "Term deposit"}</span>
          <span
            className={cn(
              "rounded-[5px] px-[7px] py-0.5 font-mono text-[10px]",
              matured ? "bg-secondary text-muted-foreground" : "bg-accent text-accent-brand",
            )}
          >
            {matured ? "Matured" : "Active"}
          </span>
          {earmarked && (
            <span className="rounded-[5px] bg-secondary px-[7px] py-0.5 font-mono text-[10px] text-muted-foreground">
              For {earmarked.name}
            </span>
          )}
        </div>
        <div className="mt-1 font-mono text-[12px] text-muted-foreground tabular-nums">
          {fmtVND(saving.principal)} · {saving.rate}%/yr · {saving.term_months}mo · {saving.start_date} → {maturityDate(saving)}
        </div>
      </div>
      <div className="flex items-center gap-[18px]">
        <div className="text-right">
          <div className="font-mono text-[14px] tabular-nums">{fmtVND(cur)}</div>
          <div className="mt-1 font-mono text-[11.5px] tabular-nums">
            <span className={interest >= 0 ? "text-accent-brand" : "text-(--chart-negative)"}>
              {interest >= 0 ? "+" : ""}{fmtVND(interest)}
            </span>{" "}
            · at maturity {fmtVND(matVal)}
          </div>
        </div>
        <div className="flex gap-1">
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
      </div>
    </div>
  );
}

function KpiTile({ label, value, valueCls, last }: { label: string; value: string; valueCls?: string; last?: boolean }) {
  return (
    <div className={cn("px-5 py-[18px]", !last && "border-b border-divider sm:border-r sm:border-b-0")}>
      <div className="text-[10.5px] font-semibold tracking-[0.14em] text-faint uppercase">{label}</div>
      <div className={cn("mt-[7px] font-mono text-[22px] tabular-nums", valueCls)}>{value}</div>
    </div>
  );
}

export function SavingsManager({ savings, funds }: { savings: Saving[]; funds: FundOption[] }) {
  const s = summarize(savings);
  const series = buildDailySeries(savings, currentValue);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 overflow-hidden card-surface sm:grid-cols-3">
        <KpiTile label="Total principal" value={fmtVND(s.principal)} />
        <KpiTile label="Current est. value" value={fmtVND(s.currentValue)} />
        <KpiTile
          label="Est. interest earned"
          value={`${s.interest >= 0 ? "+" : ""}${fmtVND(s.interest)}`}
          valueCls={s.interest >= 0 ? "text-accent-brand" : "text-(--chart-negative)"}
          last
        />
      </div>

      {series.length > 1 && (
        <ValueOverTime
          title="Savings value over time"
          subtitle="Estimated total as deposits accrue interest toward maturity"
          series={series}
          stroke="var(--chart-positive)"
          areaFill="rgb(var(--positive-rgb) / 0.13)"
          tipLabel="Value"
          emptyMessage="No deposit history yet."
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted-foreground">
          Term deposits, newest first.
        </p>
        <AddDepositDialog funds={funds} />
      </div>

      {savings.length === 0 && <p className="text-[13px] text-muted-foreground">No deposits yet.</p>}
      {savings.map((saving) => (
        <SavingRow key={saving.id} saving={saving} funds={funds} />
      ))}
    </div>
  );
}
