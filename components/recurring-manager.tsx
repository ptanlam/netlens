"use client";

import * as React from "react";
import { Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ASSET_TYPES, CRON_FREQ, METAL_UNIT, METAL_UNIT_HINT, METALS, RECURRING_FREQS, RECURRING_FREQ_LABELS, type RecurringRule } from "@/lib/types";
import { addRule, deleteRule, toggleRule, updateRule } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import { type InstrumentOption } from "@/components/tx-form";
import { Amt } from "@/components/amt";
import { occurrences } from "@/lib/recurring";
import { parseCron } from "@/lib/cron";
import { cn } from "@/lib/utils";

type ActionResult = { ok: boolean; message: string };

const CRON_LABEL = "Cron expression";

/** A hand-edited row may hold a value the list doesn't know; show it as stored. */
function freqLabel(freq: string): string {
  if (freq === CRON_FREQ) return CRON_LABEL;
  return RECURRING_FREQ_LABELS[freq as keyof typeof RECURRING_FREQ_LABELS] ?? freq;
}

/** How a rule's schedule reads in its row and the delete prompt. */
function scheduleText(rule: RecurringRule): string {
  return rule.freq === CRON_FREQ ? `on cron ${rule.cron}` : freqLabel(rule.freq).toLowerCase();
}

/** The next 10 days a cron expression runs on from `start`, or why it never does. */
function cronPreview(cron: string, start: string): string | string[] {
  try {
    parseCron(cron);
  } catch (e) {
    return (e as Error).message;
  }
  const [y, m, d] = start.split("-").map(Number);
  const from = new Date(y, (m || 1) - 1, d || 1);
  // Ten years, so even a yearly expression shows ten runs.
  const until = new Date(from.getFullYear() + 10, from.getMonth(), from.getDate());
  const runs: string[] = [];
  for (const occ of occurrences(CRON_FREQ, from, null, until, cron)) {
    runs.push(occ.toLocaleDateString("sv-SE"));
    if (runs.length === 10) break;
  }
  return runs.length ? runs : "Matches no day.";
}

export function RuleForm({
  action,
  instruments: all,
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
  // Only the types you hold, in the app's order; the holding list is then cut down to one.
  const types = ASSET_TYPES.filter((t) => all.some((i) => i.asset_type === t));
  const [assetType, setAssetType] = React.useState<string>(rule?.asset_type ?? types[0] ?? "Funds");
  const instruments = all.filter((i) => i.asset_type === assetType);
  const [instrument, setInstrument] = React.useState(rule?.instrument ?? instruments[0]?.name ?? "");
  const pickType = (t: string) => {
    setAssetType(t);
    setInstrument(all.find((i) => i.asset_type === t)?.name ?? "");
  };
  // A metal is bought by weight (see `METALS`), priced at the dealer's sell price each run.
  const metal = assetType === METALS;
  // Preset or cron, toggled; the preset you picked survives a trip to cron and back.
  const [useCron, setUseCron] = React.useState(rule?.freq === CRON_FREQ);
  const [preset, setPreset] = React.useState<string>(rule && rule.freq !== CRON_FREQ ? rule.freq : "weekly");
  const [cron, setCron] = React.useState(rule?.cron ?? "");
  const [start, setStart] = React.useState(rule?.start_date ?? today);
  const noHoldings = all.length === 0;

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
              pickType(types[0] ?? "Funds");
              setUseCron(false);
              setPreset("weekly");
              setCron("");
              setStart(today);
            }
            onDone?.();
          } else toast.error(res.message);
        })
      }
      // Cells sit at the top: a hint under one field mustn't spread out its neighbour's.
      className="grid items-start gap-4 sm:grid-cols-2"
    >
      <div className="grid gap-2">
        <Label htmlFor="r-type">Asset type</Label>
        <Select
          name="asset_type"
          value={assetType}
          onValueChange={(v) => v != null && pickType(v as string)}
          disabled={noHoldings}
        >
          <SelectTrigger id="r-type" className="w-full">
            <SelectValue placeholder="Select a type" />
          </SelectTrigger>
          <SelectContent>
            {types.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
      {metal ? (
        <div className="grid gap-2">
          <Label htmlFor="r-quantity">Weight ({METAL_UNIT})</Label>
          <Input
            key="quantity"
            id="r-quantity"
            name="quantity"
            type="number"
            step="any"
            min="0"
            defaultValue={rule?.quantity ?? undefined}
            placeholder={METAL_UNIT_HINT}
            required
          />
          <p className="text-caption text-muted-foreground">
            Each run is booked at the dealer&apos;s sell price that day.
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor="r-amount">Amount (VND)</Label>
          <CurrencyInput
            key="amount"
            id="r-amount"
            name="amount"
            defaultValue={rule?.amount}
            placeholder="5.000.000"
            required
          />
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="r-start">{useCron ? "Start date" : "Start date (anchor)"}</Label>
        <Input
          id="r-start"
          name="start_date"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          required
        />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="r-note">Note (optional)</Label>
        <Input id="r-note" name="note" defaultValue={rule?.note ?? undefined} />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={useCron ? "r-cron" : "r-freq"}>Frequency</Label>
          <div role="group" aria-label="Schedule kind" className="-my-1 flex gap-0.5 rounded-full bg-pane p-0.5">
            {([false, true] as const).map((c) => (
              <button
                key={String(c)}
                type="button"
                aria-pressed={useCron === c}
                onClick={() => setUseCron(c)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-caption font-semibold transition-colors",
                  useCron === c
                    ? "bg-card text-foreground shadow-[0_1px_3px_rgb(14_15_12/0.14)] dark:bg-pane-2"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {c ? "Cron" : "Preset"}
              </button>
            ))}
          </div>
        </div>
        <input type="hidden" name="freq" value={useCron ? CRON_FREQ : preset} />
        {useCron ? (
          <>
            <Input
              id="r-cron"
              name="cron"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 9 1,15 * *"
              className="font-mono"
              autoComplete="off"
              required
            />
            {cron.trim() && (() => {
              const preview = cronPreview(cron, start);
              return (
                <p className="text-caption text-muted-foreground tabular-nums">
                  {typeof preview === "string" ? preview : (
                    <>
                      Next runs:{" "}
                      {preview.map((d, i) => (
                        // A date never breaks at its hyphens; the line breaks between dates.
                        <React.Fragment key={d}>
                          {i > 0 && ", "}
                          <span className="whitespace-nowrap">{d}</span>
                        </React.Fragment>
                      ))}
                    </>
                  )}
                </p>
              );
            })()}
          </>
        ) : (
          <Select value={preset} onValueChange={(v) => v != null && setPreset(v as string)}>
            <SelectTrigger id="r-freq" className="w-full">
              <SelectValue>{(v: string) => freqLabel(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RECURRING_FREQS.map((f) => (
                <SelectItem key={f} value={f}>{RECURRING_FREQ_LABELS[f]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {noHoldings && (
        <p className="text-body-sm text-muted-foreground sm:col-span-2">
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
        <div className="flex items-center gap-2 font-semibold">
          {rule.instrument}
          {!rule.active && <Badge variant="secondary">paused</Badge>}
        </div>
        <div className="text-body-sm text-muted-foreground">
          {rule.quantity != null && `${rule.quantity} ${METAL_UNIT} ≈ `}
          <Amt>{fmtVND(rule.amount)}</Amt> · {scheduleText(rule)} · since {rule.start_date}
          {nextDue && ` · next ${nextDue}`}
        </div>
      </div>
      <div className="flex gap-1">
        <IconTooltip label={rule.active ? "Pause rule" : "Resume rule"}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={rule.active ? "Pause rule" : "Resume rule"}
            disabled={pending}
            onClick={() => run(() => toggleRule(rule.id))}
          >
            {rule.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
        </IconTooltip>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <IconTooltip label="Edit rule">
            <DialogTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="Edit rule" />}
            >
              <Pencil className="size-3.5" />
            </DialogTrigger>
          </IconTooltip>
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
        <IconTooltip label="Delete rule">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete rule"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Delete the rule for ${rule.instrument} (${scheduleText(rule)})? Already-created transactions stay.`))
                return;
              run(() => deleteRule(rule.id));
            }}
          >
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </IconTooltip>
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
        <p className="text-body-sm text-muted-foreground">No recurring rules yet.</p>
      )}
      {rules.map(({ rule, nextDue }) => (
        <RuleRow key={rule.id} rule={rule} nextDue={nextDue} instruments={instruments} />
      ))}
      {showAddForm && (
        <>
          <Separator className="my-2" />
          <div>
            <h3 className="mb-3 flex items-center gap-1.5 text-body-sm font-semibold">
              <Plus className="size-3.5" /> New rule
            </h3>
            <RuleForm action={addRule} instruments={instruments} />
          </div>
        </>
      )}
    </div>
  );
}
