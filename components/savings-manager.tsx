"use client";

import * as React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { INTEREST_TYPES, type Saving } from "@/lib/types";
import { addSaving, deleteSaving, updateSaving } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { currentValue, isMatured, maturityDate, maturityValue, summarize } from "@/lib/savings";
import { ValueOverTime, buildDailySeries } from "@/components/value-over-time";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

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
        <Input id="s-principal" name="principal" type="number" min="1" step="1" defaultValue={saving?.principal} placeholder="100000000" required />
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
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-4">
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
            <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit deposit" />}>
              <Pencil className="size-3.5" />
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Edit deposit</DialogTitle>
              </DialogHeader>
              <SavingForm action={(fd) => updateSaving(saving.id, fd)} saving={saving} onDone={() => setEditOpen(false)} />
            </DialogContent>
          </Dialog>
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
        </div>
      </div>
    </div>
  );
}

function KpiTile({ label, value, valueCls, last }: { label: string; value: string; valueCls?: string; last?: boolean }) {
  return (
    <div className={cn("px-5 py-[18px]", !last && "border-b border-[#edeae3] sm:border-r sm:border-b-0")}>
      <div className="font-mono text-[10.5px] tracking-[0.08em] text-[#a5a29a] uppercase">{label}</div>
      <div className={cn("mt-[7px] font-mono text-[22px] tabular-nums", valueCls)}>{value}</div>
    </div>
  );
}

export function SavingsManager({ savings }: { savings: Saving[] }) {
  const s = summarize(savings);
  const series = buildDailySeries(savings, currentValue);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-3">
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
          stroke="#2f7d55"
          areaFill="rgba(47,125,85,0.13)"
          tipLabel="Value"
          emptyMessage="No deposit history yet."
        />
      )}

      {savings.length === 0 && <p className="text-[13px] text-muted-foreground">No deposits yet.</p>}
      {savings.map((saving) => (
        <SavingRow key={saving.id} saving={saving} />
      ))}

      <div className="rounded-xl border border-border bg-card px-6 py-[22px]">
        <div className="mb-[18px] font-serif text-[17px] font-semibold">New deposit</div>
        <SavingForm action={addSaving} />
      </div>
    </div>
  );
}
