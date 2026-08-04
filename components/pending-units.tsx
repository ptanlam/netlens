"use client";

import * as React from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import type { Tx } from "@/lib/types";
import { setTxQty } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface PendingRow {
  tx: Tx;
  window: [string, string];
  estUnits: number | null;
  hasHoldingQty: boolean;
}

function PendingItem({ row }: { row: PendingRow }) {
  const [pending, startTransition] = React.useTransition();
  const [units, setUnits] = React.useState(row.estUnits?.toString() ?? "");
  const [addToHoldings, setAddToHoldings] = React.useState(row.hasHoldingQty);
  const id = `units-${row.tx.id}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-5 rounded-xl border border-border bg-card px-4 py-3.5">
      <div>
        <div className="text-[14px] font-semibold">{row.tx.instrument}</div>
        <div className="mt-[3px] font-mono text-[12px] text-muted-foreground tabular-nums">
          {row.tx.date} · {fmtVND(row.tx.amount)} · expected {row.window[0]} – {row.window[1]}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3.5">
        <div>
          <label htmlFor={id} className="mb-1.5 block text-[12px] text-muted-foreground">
            Confirmed units{row.estUnits ? ` (est. ${row.estUnits})` : ""}
          </label>
          <input
            id={id}
            type="number"
            step="any"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            className="w-[120px] rounded-lg border border-input bg-pane px-2.5 py-[7px] font-mono text-[13px] outline-none focus:border-ring"
          />
        </div>
        {row.hasHoldingQty && (
          <label className="flex items-center gap-1.5 pb-2 text-[12.5px] text-muted-foreground">
            <input
              type="checkbox"
              checked={addToHoldings}
              onChange={(e) => setAddToHoldings(e.target.checked)}
              className="accent-(--foreground)"
            />
            add to holding
          </label>
        )}
        <Button
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

export function PendingUnitsCard({ pending }: { pending: PendingRow[] }) {
  const [open, setOpen] = React.useState(false);

  return (
    // The same amber alert the dashboard shows for this exact condition — it links here,
    // so arriving at a neutral panel made the two read as different problems.
    <div className="rounded-xl border border-warning-border bg-warning-bg px-5 py-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <TriangleAlert className="size-4 shrink-0 text-warning" />
        <span className="text-[13.5px] font-semibold">Awaiting fund units</span>
        <Badge variant="warning">{pending.length}</Badge>
        <ChevronDown
          className={cn(
            "ml-auto size-4 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <>
          <div className="mt-1 text-[12.5px] text-muted-foreground">
            Fund purchases confirm T+1 / T+2 business days. Enter the units from your confirmation email.
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {pending.map((row) => (
              <PendingItem key={row.tx.id} row={row} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
