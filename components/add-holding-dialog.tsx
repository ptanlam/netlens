"use client";

import * as React from "react";
import { ImageIcon, Pencil, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { ASSET_TYPES, MANUAL_SOURCE, type Instrument } from "@/lib/types";
import { addHolding, updateHolding } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { instrumentLogo } from "@/lib/logos";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/tooltip";
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

/** The bundled marks' size (`lib/logos.ts`): 3× the largest avatar. */
const LOGO_PX = 96;

/** A picked image, drawn into a 96px square and letterboxed — the size and shape of the
 *  bundled marks — so what's uploaded is a few KB however big the file was. WebP where the
 *  browser can encode it, PNG where it can't (Safari hands back PNG when asked for WebP). */
async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // An SVG with no width/height has no natural size; treat it as square.
    const w = img.naturalWidth || LOGO_PX;
    const h = img.naturalHeight || LOGO_PX;
    const k = LOGO_PX / Math.max(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = LOGO_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (LOGO_PX - w * k) / 2, (LOGO_PX - h * k) / 2, w * k, h * k);
    const webp = canvas.toDataURL("image/webp", 0.9);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The holding's logo: a preview, a picker, and a way back out. What it submits, as the
 * hidden `logo` field: "" leaves the logo as it is, "remove" drops an upload, and a data:
 * URL is a new one. Only an *upload* can be removed — a bundled mark isn't the holding's to
 * lose, and it's what shows again once the upload is gone.
 */
function LogoField({
  holding,
  value,
  onChange,
}: {
  holding?: Instrument;
  value: string;
  onChange: (v: string) => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const bundled = holding ? instrumentLogo({ name: holding.name, symbol: holding.symbol }) : undefined;
  const current = holding ? instrumentLogo(holding) : undefined;
  const preview = value.startsWith("data:") ? value : value === "remove" ? bundled : current;
  const removable = value.startsWith("data:") || (holding?.logo_at != null && value !== "remove");

  return (
    <div className="grid gap-2 sm:col-span-2">
      <Label htmlFor="h-logo">Logo (optional)</Label>
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full border border-divider bg-white">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="size-full object-contain p-1" />
          ) : (
            <ImageIcon className="size-5 text-faint" />
          )}
        </span>
        <input
          ref={fileRef}
          id="h-logo"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
          className="sr-only"
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            try {
              onChange(await shrinkLogo(file));
            } catch {
              toast.error("Couldn't read that image. Try a PNG or JPEG.");
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="size-3.5" />
          {preview ? "Replace" : "Upload logo"}
        </Button>
        {removable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(value.startsWith("data:") ? "" : "remove")}
          >
            {value.startsWith("data:") ? "Undo" : "Remove"}
          </Button>
        )}
      </div>
      <input type="hidden" name="logo" value={value} />
      <p className="text-caption text-muted-foreground">
        PNG, JPEG, WebP or SVG. It&apos;s shrunk to a small square before it&apos;s saved.
      </p>
    </div>
  );
}

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
  const [logo, setLogo] = React.useState("");
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
            setLogo("");
            onDone?.();
          } else toast.error(res.message);
        })
      }
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="h-name">Name</Label>
        {holding ? (
          <div className="flex h-9 items-center rounded-lg border border-input bg-muted/40 px-3 text-body-sm text-muted-foreground">
            {holding.name}
          </div>
        ) : (
          <Input id="h-name" name="name" placeholder="e.g. VCBF-TBF" required />
        )}
      </div>
      <LogoField holding={holding} value={logo} onChange={setLogo} />
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
        <p className="text-caption text-muted-foreground">
          {!priced ? (
            "No live price for this holding — it is worth exactly what you enter here."
          ) : liveValue != null ? (
            <>
              Currently <span className="font-semibold">ignored</span>: a live price is active, so this
              holding is valued at <span className="font-mono">{fmtVND(liveValue)}</span> (quantity ×
              last price). It is only used if the price feed stops returning a price.
            </>
          ) : holding ? (
            <>
              <span className="font-semibold">In use right now</span>: this holding has no{" "}
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
      <DialogTrigger render={<Button />}>
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
      <IconTooltip label="Edit holding">
        <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit holding" />}>
          <Pencil className="size-3.5" />
        </DialogTrigger>
      </IconTooltip>
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
