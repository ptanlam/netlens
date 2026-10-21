"use client";

import * as React from "react";
import { ChevronDown, Gift } from "lucide-react";
import { toast } from "sonner";
import type { MissedAction } from "@/lib/corporate-actions";
import { dismissCorporateAction, recordCorporateAction } from "@/app/actions";
import { Collapsible } from "@animate-ui/react/primitives/base-ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function ActionItem({ action }: { action: MissedAction }) {
  const [pending, startTransition] = React.useTransition();
  const [value, setValue] = React.useState(String(action.value));
  const id = `corp-${action.key}`;
  const bonus = action.kind === "bonus";
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3.5 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
      <div className="min-w-0 sm:self-center">
        <div className="text-body-sm font-semibold">
          {action.instrument} · {bonus ? "Bonus units" : "Cash dividend"}
        </div>
        <div className="mt-[3px] flex flex-wrap gap-x-1.5 font-mono text-caption text-muted-foreground tabular-nums">
          <span className="whitespace-nowrap">ex-date {action.date}</span>·<span>{action.basis}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <label htmlFor={id} className="mb-1.5 block text-caption text-muted-foreground">
            {bonus ? "Units received" : "Received (VND)"}
          </label>
          {bonus ? (
            <Input
              id={id}
              type="number"
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono tabular-nums sm:w-32"
            />
          ) : (
            <CurrencyInput
              id={id}
              name="value"
              defaultValue={action.value}
              onValueChange={(v) => setValue(String(v ?? ""))}
              className="font-mono tabular-nums sm:w-40"
            />
          )}
        </div>
        <Button
          variant="ghost"
          className="h-10 shrink-0"
          disabled={pending}
          onClick={() => run(() => dismissCorporateAction(action.key))}
        >
          Dismiss
        </Button>
        <Button
          className="h-10 shrink-0"
          disabled={pending || !(Number(value) > 0)}
          onClick={() => run(() => recordCorporateAction(action.key, Number(value)))}
        >
          Record
        </Button>
      </div>
    </div>
  );
}

/** Dividends and splits Yahoo lists for a holding that its transactions don't show. */
export function CorporateActionsCard({ actions }: { actions: MissedAction[] }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-warning-border bg-warning-bg px-5 py-4"
    >
      <Collapsible.Trigger className="flex w-full items-center gap-2.5 text-left outline-none focus-visible:underline">
        <Gift className="size-4 shrink-0 text-warning" />
        <span className="text-body-sm font-semibold">Dividends and splits not recorded</span>
        <Badge variant="warning">{actions.length}</Badge>
        <ChevronDown
          className={cn(
            "ml-auto size-4 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </Collapsible.Trigger>
      <Collapsible.Panel>
        <div className="mt-1 text-caption text-muted-foreground">
          From Yahoo&apos;s dividend and split dates. Check each against your broker before
          recording: a rights issue you didn&apos;t buy into also shows up as a split. Dismiss
          one you already counted by editing the holding&apos;s units.
        </div>
        <div className="mt-4 flex flex-col gap-3">
          {actions.map((a) => (
            <ActionItem key={a.key} action={a} />
          ))}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
