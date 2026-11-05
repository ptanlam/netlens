"use client";

import * as React from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { TX_KIND_LABEL, txKind, type Tx } from "@/lib/types";
import { setTxQty } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { Collapsible } from "@animate-ui/react/primitives/base-ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Amt } from "@/components/amt";

export interface PendingRow {
  tx: Tx;
  /** The T+1 – T+2 confirmation window of a fund buy; null for any other row missing units. */
  window: [string, string] | null;
  estUnits: number | null;
  hasHoldingQty: boolean;
  /** Whether "add to holding" starts ticked — see `app/transactions/page.tsx`. */
  addByDefault: boolean;
}

function PendingItem({ row }: { row: PendingRow }) {
  const [pending, startTransition] = React.useTransition();
  const [units, setUnits] = React.useState(row.estUnits?.toString() ?? "");
  const [addToHoldings, setAddToHoldings] = React.useState(row.addByDefault);
  const id = `units-${row.tx.id}`;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3.5 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
      <div className="min-w-0 sm:self-center">
        <div className="text-body-sm font-semibold">{row.tx.instrument}</div>
        {/* Each piece stays whole, so a narrow row wraps between them, never inside a date. */}
        <div className="mt-[3px] flex flex-wrap gap-x-1.5 font-mono text-caption text-muted-foreground tabular-nums">
          <span>{row.tx.date}</span>·<span>{TX_KIND_LABEL[txKind(row.tx)]}</span>·
          <Amt>{fmtVND(Math.abs(row.tx.amount))}</Amt>
          {row.window && (
            <>·<span className="whitespace-nowrap">expected {row.window[0]} – {row.window[1]}</span></>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <label htmlFor={id} className="mb-1.5 block text-caption text-muted-foreground">
            {row.window ? "Confirmed units" : txKind(row.tx) === "sell" ? "Units sold" : "Units bought"}
            {row.estUnits ? ` (est. ${row.estUnits})` : ""}
          </label>
          <Input
            id={id}
            type="number"
            step="any"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            className="font-mono tabular-nums sm:w-32"
          />
        </div>
        {row.hasHoldingQty && (
          <label className="flex h-10 shrink-0 items-center gap-2 text-caption text-muted-foreground">
            <Checkbox checked={addToHoldings} onCheckedChange={setAddToHoldings} />
            add to holding
          </label>
        )}
        <Button
          className="ml-auto h-10 shrink-0 sm:ml-0"
          disabled={pending || !units || Number(units) <= 0}
          onClick={() =>
            startTransition(async () => {
              const res = await setTxQty(row.tx.id, Number(units), addToHoldings);
              if (res.ok) toast.success(res.message);
              else toast.error(res.message);
            })
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function Group({ intro, rows }: { intro: string; rows: PendingRow[] }) {
  return (
    <div className="mt-3 first:mt-1">
      <div className="text-caption text-muted-foreground">{intro}</div>
      <div className="mt-3 flex flex-col gap-3">
        {rows.map((row) => (
          <PendingItem key={row.tx.id} row={row} />
        ))}
      </div>
    </div>
  );
}

/**
 * Transactions whose unit count is missing: fund buys still inside their T+1/T+2 window
 * (`pending`) and every other buy or sell of a priced holding saved without one
 * (`missing`, `db.missingUnitsTxs`). One card, because the fix is the same Save.
 */
export function PendingUnitsCard({ pending, missing }: { pending: PendingRow[]; missing: PendingRow[] }) {
  const [open, setOpen] = React.useState(false);
  const title = missing.length === 0 ? "Awaiting fund units" : pending.length === 0 ? "Missing units" : "Awaiting units";

  return (
    // The same amber alert the dashboard shows for this exact condition — it links here,
    // so arriving at a neutral panel made the two read as different problems.
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-warning-border bg-warning-bg px-5 py-4"
    >
      <Collapsible.Trigger className="flex w-full items-center gap-2.5 text-left outline-none focus-visible:underline">
        <TriangleAlert className="size-4 shrink-0 text-warning" />
        <span className="text-body-sm font-semibold">{title}</span>
        <Badge variant="warning">{pending.length + missing.length}</Badge>
        <ChevronDown
          className={cn(
            "ml-auto size-4 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </Collapsible.Trigger>
      <Collapsible.Panel>
        {pending.length > 0 && (
          <Group
            intro="Fund purchases confirm T+1 / T+2 business days. Enter the units from your confirmation email."
            rows={pending}
          />
        )}
        {missing.length > 0 && (
          <Group
            intro="Recorded without a unit count, so they're priced at that day's close instead of your fill. Enter the units from your statement."
            rows={missing}
          />
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
