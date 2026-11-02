"use client";

import * as React from "react";
import { toast } from "sonner";
import { ASSET_TYPES, METAL_UNIT, METAL_UNIT_HINT, METALS, txKind, type Tx } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** The Type picker's labels, also what its closed trigger shows. */
const TX_TYPES = {
  buy: "Buy / contribute",
  sell: "Sell / withdraw",
  dividend: "Cash dividend",
  bonus: "Units adjustment (split, bonus, transfer fee)",
};

export type ActionResult = { ok: boolean; message: string };

/** A managed holding the transaction can be tied to. */
export type InstrumentOption = { name: string; asset_type: string };

export function TxForm({
  action,
  instruments: all,
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

  // Only the types you hold, in the app's order; the holding list is then cut down to one.
  const types = ASSET_TYPES.filter((t) => all.some((i) => i.asset_type === t));
  // Editing: the holding's own type wins, so an old row whose stored type drifted still finds it.
  const [assetType, setAssetType] = React.useState<string>(
    all.find((i) => i.name === tx?.instrument)?.asset_type ?? tx?.asset_type ?? types[0] ?? "Funds",
  );
  const instruments = all.filter((i) => i.asset_type === assetType);
  const [instrument, setInstrument] = React.useState(tx?.instrument ?? instruments[0]?.name ?? "");
  const [direction, setDirection] = React.useState<string>(tx ? txKind(tx) : "buy");
  const pickType = (t: string) => {
    setAssetType(t);
    setInstrument(all.find((i) => i.asset_type === t)?.name ?? "");
  };
  const noHoldings = all.length === 0;
  // A metal's weight is never priced out of the amount (see `METALS`), so it's asked for.
  const weighed = assetType === METALS && direction !== "bonus";

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
              pickType(types[0] ?? "Funds");
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
        <Label htmlFor="direction">Type</Label>
        <Select name="direction" value={direction} items={TX_TYPES} onValueChange={(v) => v != null && setDirection(v as string)}>
          <SelectTrigger id="direction" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TX_TYPES).map(([v, label]) => (
              <SelectItem key={v} value={v}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="asset_type">Asset type</Label>
        <Select
          name="asset_type"
          value={assetType}
          onValueChange={(v) => v != null && pickType(v as string)}
          disabled={noHoldings}
        >
          <SelectTrigger id="asset_type" className="w-full">
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
      {/* A dividend is only money and bonus units are only units, so each hides the other field. */}
      {direction !== "bonus" && (
        <div className="grid gap-2">
          <Label htmlFor="amount">{direction === "dividend" ? "Dividend received (VND)" : "Amount (VND)"}</Label>
          <CurrencyInput
            id="amount"
            name="amount"
            defaultValue={tx ? Math.abs(tx.amount) : undefined}
            placeholder="1.000.000"
            required
          />
        </div>
      )}
      {direction !== "dividend" && (
        <div className="grid gap-2">
          <Label htmlFor="quantity">
            {direction === "bonus" ? "Units (+ received, − removed)" : weighed ? `Weight (${METAL_UNIT})` : "Quantity (optional)"}
          </Label>
          <Input
            id="quantity"
            name="quantity"
            type="number"
            step="any"
            // Signed for an adjustment, which can take units away; the other kinds carry
            // their sign in the Type.
            defaultValue={tx?.quantity != null ? (direction === "bonus" ? tx.quantity : Math.abs(tx.quantity)) : undefined}
            placeholder={
              direction === "bonus" ? "e.g. 150 bonus shares, or -0.0005 network fee"
                : weighed ? METAL_UNIT_HINT : "units / shares / coins"
            }
            required={direction === "bonus" || weighed}
          />
        </div>
      )}
      <div className="grid gap-2 sm:col-span-2">
        {/* An adjustment moves units with no money, so its note is the only record of why. */}
        <Label htmlFor="note">{direction === "bonus" ? "Reason" : "Note (optional)"}</Label>
        <Input
          id="note"
          name="note"
          defaultValue={tx?.note ?? undefined}
          required={direction === "bonus"}
          placeholder={direction === "bonus" ? "e.g. 2-for-1 split, moved to cold wallet" : undefined}
        />
      </div>
      {noHoldings && (
        <p className="text-body-sm text-muted-foreground sm:col-span-2">
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
