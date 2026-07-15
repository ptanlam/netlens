"use client";

import * as React from "react";
import { toast } from "sonner";
import type { Tx } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export type ActionResult = { ok: boolean; message: string };

/** A managed holding the transaction can be tied to. */
export type InstrumentOption = { name: string; asset_type: string };

export function TxForm({
  action,
  instruments,
  tx,
  submitLabel = "Save transaction",
  onDone,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  instruments: InstrumentOption[];
  tx?: Tx;
  submitLabel?: string;
  onDone?: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);
  const today = new Date().toLocaleDateString("sv-SE");

  const [instrument, setInstrument] = React.useState(tx?.instrument ?? instruments[0]?.name ?? "");
  const [direction, setDirection] = React.useState((tx?.amount ?? 1) < 0 ? "sell" : "buy");
  // Asset type is inherited from the chosen holding — a transaction can't drift from it.
  const assetType =
    instruments.find((i) => i.name === instrument)?.asset_type ?? tx?.asset_type ?? "Funds";
  const noHoldings = instruments.length === 0;

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          const res = await action(fd);
          if (res.ok) {
            toast.success(res.message);
            if (!tx) {
              formRef.current?.reset();
              setInstrument(instruments[0]?.name ?? "");
              setDirection("buy");
            }
            onDone?.();
          } else toast.error(res.message);
        })
      }
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="grid gap-2">
        <Label htmlFor="date">Date</Label>
        <Input id="date" name="date" type="date" defaultValue={tx?.date ?? today} required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="direction">Direction</Label>
        <Select name="direction" value={direction} onValueChange={(v) => v != null && setDirection(v as string)}>
          <SelectTrigger id="direction" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="buy">Buy / contribute</SelectItem>
            <SelectItem value="sell">Sell / withdraw</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="instrument">Holding</Label>
        <Select
          name="instrument"
          value={instrument}
          onValueChange={(v) => v != null && setInstrument(v as string)}
          disabled={noHoldings}
        >
          <SelectTrigger id="instrument" className="w-full">
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
        <Label htmlFor="amount">Amount (VND)</Label>
        <CurrencyInput
          id="amount"
          name="amount"
          defaultValue={tx ? Math.abs(tx.amount) : undefined}
          placeholder="1.000.000"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="quantity">Quantity (optional)</Label>
        <Input
          id="quantity"
          name="quantity"
          type="number"
          step="any"
          defaultValue={tx?.quantity != null ? Math.abs(tx.quantity) : undefined}
          placeholder="units / shares / coins"
        />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="note">Note (optional)</Label>
        <Input id="note" name="note" defaultValue={tx?.note ?? undefined} />
      </div>
      {noHoldings && (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          No holdings yet — add one on the Holdings page first, then it can be traded here.
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending || noHoldings || !instrument}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
