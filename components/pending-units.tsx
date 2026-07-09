"use client";

import * as React from "react";
import { toast } from "sonner";
import type { Tx } from "@/lib/types";
import { setTxQty } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
      <div className="min-w-40 flex-1">
        <div className="font-medium">{row.tx.instrument}</div>
        <div className="text-sm text-muted-foreground">
          {row.tx.date} · {fmtVND(row.tx.amount)} · expected {row.window[0]}–{row.window[1]}
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={id} className="text-xs">
          Confirmed units{row.estUnits ? ` (est. ${row.estUnits})` : ""}
        </Label>
        <Input
          id={id}
          type="number"
          step="any"
          className="w-36"
          value={units}
          onChange={(e) => setUnits(e.target.value)}
        />
      </div>
      {row.hasHoldingQty && (
        <label className="flex h-9 items-center gap-2 text-sm">
          <Checkbox
            checked={addToHoldings}
            onCheckedChange={(v) => setAddToHoldings(v === true)}
          />
          add to holding
        </label>
      )}
      <Button
        size="sm"
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
  );
}

export function PendingUnitsCard({ pending }: { pending: PendingRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Awaiting fund units</CardTitle>
        <CardDescription>
          Fund purchases are confirmed T+1/T+2 business days. Enter the units from your
          confirmation email.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {pending.map((row) => (
          <PendingItem key={row.tx.id} row={row} />
        ))}
      </CardContent>
    </Card>
  );
}
