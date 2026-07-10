"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ASSET_TYPES, PRICE_SOURCES } from "@/lib/types";
import { addHolding } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export function AddHoldingDialog() {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [source, setSource] = React.useState("manual");
  const formRef = React.useRef<HTMLFormElement>(null);
  const priced = source !== "manual";

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
        <form
          ref={formRef}
          action={(fd) =>
            startTransition(async () => {
              const res = await addHolding(fd);
              if (res.ok) {
                toast.success(res.message);
                formRef.current?.reset();
                setSource("manual");
                setOpen(false);
              } else toast.error(res.message);
            })
          }
          className="grid gap-4 sm:grid-cols-2"
        >
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="h-name">Name</Label>
            <Input id="h-name" name="name" placeholder="e.g. VCBF-TBF" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="h-type">Asset type</Label>
            <Select name="asset_type" defaultValue="Funds">
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
                {PRICE_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="h-symbol">Symbol{priced ? "" : " (optional)"}</Label>
            <Input id="h-symbol" name="symbol" placeholder="CoinGecko id / ticker / fmarket" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="h-qty">Quantity (optional)</Label>
            <Input id="h-qty" name="quantity" type="number" step="any" placeholder="units / shares / coins" />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="h-manual">
              Manual value (VND){priced ? " — used until a live price is fetched" : ""}
            </Label>
            <Input id="h-manual" name="manual_value" type="number" step="1" placeholder="10000000" />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add holding"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
