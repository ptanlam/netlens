"use client";

import * as React from "react";
import { toast } from "sonner";
import { ASSET_TYPES, type Tx } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export type ActionResult = { ok: boolean; message: string };

export function TxForm({
  action,
  instruments,
  tx,
  submitLabel = "Save transaction",
  onDone,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  instruments: string[];
  tx?: Tx;
  submitLabel?: string;
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
            if (!tx) formRef.current?.reset();
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
        <Select name="direction" defaultValue={(tx?.amount ?? 1) < 0 ? "sell" : "buy"}>
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
        <Label htmlFor="asset_type">Asset type</Label>
        <Select name="asset_type" defaultValue={tx?.asset_type ?? "Funds"}>
          <SelectTrigger id="asset_type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASSET_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="instrument">Instrument</Label>
        <Input
          id="instrument"
          name="instrument"
          list="instrument-names"
          defaultValue={tx?.instrument}
          placeholder="e.g. VCBF-TBF"
          required
        />
        <datalist id="instrument-names">
          {instruments.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="amount">Amount (VND)</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          min="1"
          step="1"
          defaultValue={tx ? Math.abs(tx.amount) : undefined}
          placeholder="1000000"
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
          defaultValue={tx?.quantity ?? undefined}
          placeholder="units / shares / coins"
        />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="note">Note (optional)</Label>
        <Input id="note" name="note" defaultValue={tx?.note ?? undefined} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
