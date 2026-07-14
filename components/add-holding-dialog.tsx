"use client";

import * as React from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { ASSET_TYPES, MANUAL_SOURCE, type Instrument } from "@/lib/types";
import { addHolding, updateHolding } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type ActionResult = { ok: boolean; message: string };

/** Shared fields for adding or editing a holding. On edit the name is fixed
 *  (renaming would orphan its transactions), so it's shown read-only. */
function HoldingForm({
  holding,
  action,
  submitLabel,
  onDone,
  sources,
}: {
  holding?: Instrument;
  action: (fd: FormData) => Promise<ActionResult>;
  submitLabel: string;
  onDone?: () => void;
  sources: string[];
}) {
  const [pending, startTransition] = React.useTransition();
  const [source, setSource] = React.useState(holding?.price_source ?? MANUAL_SOURCE);
  const formRef = React.useRef<HTMLFormElement>(null);
  const priced = source !== MANUAL_SOURCE;
  // Same condition as db.holdingValue(): manual_value is only consulted when one of
  // these is missing. Non-null means manual_value is inert right now.
  const liveValue =
    holding?.quantity != null && holding?.last_price != null
      ? Math.round(holding.quantity * holding.last_price)
      : null;

  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          const res = await action(fd);
          if (res.ok) {
            toast.success(res.message);
            if (!holding) {
              formRef.current?.reset();
              setSource(MANUAL_SOURCE);
            }
            onDone?.();
          } else toast.error(res.message);
        })
      }
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="h-name">Name</Label>
        {holding ? (
          <div className="flex h-9 items-center rounded-lg border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
            {holding.name}
          </div>
        ) : (
          <Input id="h-name" name="name" placeholder="e.g. VCBF-TBF" required />
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="h-type">Asset type</Label>
        <Select name="asset_type" defaultValue={holding?.asset_type ?? "Funds"}>
          <SelectTrigger id="h-type" className="w-full">
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
        <Label htmlFor="h-source">Price source</Label>
        <Select name="price_source" value={source} onValueChange={(v) => v != null && setSource(v as string)}>
          <SelectTrigger id="h-source" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sources.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="h-symbol">Symbol{priced ? "" : " (optional)"}</Label>
        <Input id="h-symbol" name="symbol" defaultValue={holding?.symbol ?? undefined} placeholder="CoinGecko id / ticker / fmarket" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="h-qty">Quantity (optional)</Label>
        <Input id="h-qty" name="quantity" type="number" step="any" defaultValue={holding?.quantity ?? undefined} placeholder="units / shares / coins" />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="h-manual">{priced ? "Fallback value (VND)" : "Value (VND)"}</Label>
        <CurrencyInput id="h-manual" name="manual_value" defaultValue={holding?.manual_value ?? undefined} placeholder="10.000.000" />
        <p className="text-xs text-muted-foreground">
          {!priced ? (
            "No live price for this holding — it is worth exactly what you enter here."
          ) : liveValue != null ? (
            <>
              Currently <span className="font-medium">ignored</span>: a live price is active, so this
              holding is valued at <span className="font-mono">{fmtVND(liveValue)}</span> (quantity ×
              last price). It is only used if the price feed stops returning a price.
            </>
          ) : holding ? (
            <>
              <span className="font-medium">In use right now</span>: this holding has no{" "}
              {holding.last_price == null ? "live price" : "quantity"} yet, so it is valued at this
              amount. A live price takes over once quantity × last price are both known.
            </>
          ) : (
            "Used until the first live price is fetched, and whenever a live price is unavailable."
          )}
        </p>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function AddHoldingDialog({ sources }: { sources: string[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-3.5" />
        Add holding
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add holding</DialogTitle>
          <DialogDescription>
            Create a tracked instrument. Give it a live price source, symbol and quantity,
            or leave it manual and enter a value.
          </DialogDescription>
        </DialogHeader>
        <HoldingForm action={addHolding} submitLabel="Add holding" onDone={() => setOpen(false)} sources={sources} />
      </DialogContent>
    </Dialog>
  );
}

export function EditHoldingDialog({ holding, sources }: { holding: Instrument; sources: string[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit holding" />}>
        <Pencil className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit holding</DialogTitle>
          <DialogDescription>
            Update how {holding.name} is valued — price source, symbol, quantity, or the value used
            when no live price is available.
          </DialogDescription>
        </DialogHeader>
        <HoldingForm
          holding={holding}
          action={(fd) => updateHolding(holding.name, fd)}
          submitLabel="Update holding"
          onDone={() => setOpen(false)}
          sources={sources}
        />
      </DialogContent>
    </Dialog>
  );
}
