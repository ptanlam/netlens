"use client";

import * as React from "react";
import { Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type RecurringRule } from "@/lib/types";
import { addRule, deleteRule, toggleRule, updateRule } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { type InstrumentOption } from "@/components/tx-form";

type ActionResult = { ok: boolean; message: string };

export function RuleForm({
  action,
  instruments,
  rule,
  onDone,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  instruments: InstrumentOption[];
  rule?: RecurringRule;
  onDone?: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);
  const today = new Date().toLocaleDateString("sv-SE");

  const [instrument, setInstrument] = React.useState(rule?.instrument ?? instruments[0]?.name ?? "");
  // Asset type follows the chosen holding — a rule can't drift from it.
  const assetType =
    instruments.find((i) => i.name === instrument)?.asset_type ?? rule?.asset_type ?? "Funds";
  const noHoldings = instruments.length === 0;

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          const res = await action(fd);
          if (res.ok) {
            toast.success(res.message);
            if (!rule) {
              formRef.current?.reset();
              setInstrument(instruments[0]?.name ?? "");
            }
            onDone?.();
          } else toast.error(res.message);
        })
      }
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="grid gap-2">
        <Label htmlFor="r-instrument">Holding</Label>
        <Select
          name="instrument"
          value={instrument}
          onValueChange={(v) => v != null && setInstrument(v as string)}
          disabled={noHoldings}
        >
          <SelectTrigger id="r-instrument" className="w-full">
            <SelectValue placeholder="Select a holding" />
          </SelectTrigger>
          <SelectContent>
            {instruments.map((i) => (
              <SelectItem key={i.name} value={i.name}>{i.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label>Asset type</Label>
        <div className="flex h-9 items-center rounded-lg border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
          {assetType}
        </div>
        <input type="hidden" name="asset_type" value={assetType} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="r-amount">Amount (VND)</Label>
        <CurrencyInput
          id="r-amount"
          name="amount"
          defaultValue={rule?.amount}
          placeholder="5.000.000"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="r-freq">Frequency</Label>
        <Select name="freq" defaultValue={rule?.freq ?? "weekly"}>
          <SelectTrigger id="r-freq" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="r-start">Start date (anchor)</Label>
        <Input
          id="r-start"
          name="start_date"
          type="date"
          defaultValue={rule?.start_date ?? today}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="r-note">Note (optional)</Label>
        <Input id="r-note" name="note" defaultValue={rule?.note ?? undefined} />
      </div>
      {noHoldings && (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          No holdings yet — add one on the Holdings page first, then it can be scheduled here.
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending || noHoldings || !instrument}>
          {pending ? "Saving…" : rule ? "Update rule" : "Add rule"}
        </Button>
      </div>
    </form>
  );
}

function RuleRow({
  rule,
  nextDue,
  instruments,
}: {
  rule: RecurringRule;
  nextDue: string | null;
  instruments: InstrumentOption[];
}) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    });

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <div className="min-w-40 flex-1">
        <div className="flex items-center gap-2 font-medium">
          {rule.instrument}
          {!rule.active && <Badge variant="secondary">paused</Badge>}
        </div>
        <div className="text-sm text-muted-foreground">
          {fmtVND(rule.amount)} · {rule.freq} · since {rule.start_date}
          {nextDue && ` · next ${nextDue}`}
        </div>
      </div>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={rule.active ? "Pause rule" : "Resume rule"}
          disabled={pending}
          onClick={() => run(() => toggleRule(rule.id))}
        >
          {rule.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label="Edit rule" />}
          >
            <Pencil className="size-3.5" />
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Edit rule</DialogTitle>
            </DialogHeader>
            <RuleForm
              action={(fd) => updateRule(rule.id, fd)}
              instruments={instruments}
              rule={rule}
              onDone={() => setEditOpen(false)}
            />
          </DialogContent>
        </Dialog>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete rule"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Delete the ${rule.freq} rule for ${rule.instrument}? Already-created transactions stay.`))
              return;
            run(() => deleteRule(rule.id));
          }}
        >
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

export function RecurringManager({
  rules,
  instruments,
  showAddForm = true,
}: {
  rules: { rule: RecurringRule; nextDue: string | null }[];
  instruments: InstrumentOption[];
  showAddForm?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {rules.length === 0 && (
        <p className="text-sm text-muted-foreground">No recurring rules yet.</p>
      )}
      {rules.map(({ rule, nextDue }) => (
        <RuleRow key={rule.id} rule={rule} nextDue={nextDue} instruments={instruments} />
      ))}
      {showAddForm && (
        <>
          <Separator className="my-2" />
          <div>
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium">
              <Plus className="size-3.5" /> New rule
            </h3>
            <RuleForm action={addRule} instruments={instruments} />
          </div>
        </>
      )}
    </div>
  );
}
