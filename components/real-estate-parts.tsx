"use client";

import * as React from "react";
import { ExternalLink, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  COMP_KINDS, LAND_USE_LABELS, ROAD_ACCESS_LABELS,
  type Property, type PropertyComp, type PropertyIndexPoint, type PropertyValuation,
  type ValuationSource,
} from "@/lib/types";
import {
  addComp, addIndexPoint, applyEstimate, deleteComp, deleteIndexPoint, deleteProperty,
  deleteValuation, findListings, importListings, saveProperty, updateComp,
} from "@/app/actions";
import type { Listing } from "@/lib/listings";
import { fmtVND } from "@/lib/format";
import {
  ASKING_DISCOUNT, fmtLatLng, offsetKm,
  type Anchor, type ScoredComp, type Valuation,
} from "@/lib/realestate";
import { cn } from "@/lib/utils";
import { PanelHead } from "@/components/panel-head";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { IconTooltip } from "@/components/ui/tooltip";

type ActionResult = { ok: boolean; message: string };

/** A Real Estate holding, with the value net worth currently reads for it. */
export type EstateHolding = { name: string; value: number };

const COMP_KIND_LABELS: Record<(typeof COMP_KINDS)[number], string> = {
  sale: "Sold for",
  asking: "Listed at (asking)",
};

/** A short menu rather than a number field: the useful answers are few, and "Off" reads
 *  better than a 0. */
const AUTO_COMPS_LABELS: Record<string, string> = {
  "0": "Off",
  "5": "5 nearest listings",
  "10": "10 nearest listings",
  "20": "20 nearest listings",
};

const VALUATION_SOURCE_LABELS: Record<ValuationSource, string> = {
  initial: "Before the first booking",
  estimate: "Booked from the estimate",
  manual: "Typed on Investments",
};

const LOCATION_HINT = "Coordinates or a Google Maps link. In Maps, long-press the spot and copy what appears.";

export function fmtPerM2(v: number) {
  return `${fmtVND(Math.round(v))}/m²`;
}

export function fmtKm(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

/** A form that runs a server action, toasts the result, and resets itself after an add. */
function ActionForm({
  action,
  resetOnOk,
  onDone,
  className,
  children,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  resetOnOk?: boolean;
  onDone?: () => void;
  className?: string;
  children: (pending: boolean) => React.ReactNode;
}) {
  const [pending, startTransition] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={(fd) =>
        startTransition(async () => {
          const res = await action(fd);
          if (res.ok) {
            toast.success(res.message);
            if (resetOnOk) formRef.current?.reset();
            onDone?.();
          } else toast.error(res.message);
        })
      }
      className={className}
    >
      {children(pending)}
    </form>
  );
}

/** One of the fixed enums, shown by its label rather than its stored value. */
function EnumSelect({
  id,
  name,
  labels,
  defaultValue,
}: {
  id: string;
  name: string;
  labels: Record<string, string>;
  defaultValue: string;
}) {
  // Controlled, holding its own value from first render: a save revalidates the page while
  // the edit dialog is still open, and an uncontrolled Select whose `defaultValue` then
  // changes under it is something Base UI warns about.
  const [value, setValue] = React.useState(defaultValue);
  return (
    <Select name={name} value={value} onValueChange={(v) => setValue(String(v ?? defaultValue))} items={labels}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(labels).map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------- forms ----------

export function PropertyForm({
  holding,
  property,
  onDone,
}: {
  holding: string;
  property?: Property;
  onDone?: () => void;
}) {
  return (
    <ActionForm action={(fd) => saveProperty(holding, fd)} onDone={onDone} className="grid gap-4 sm:grid-cols-2">
      {(pending) => (
        <>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={`p-loc-${holding}`}>Location</Label>
            <Input
              id={`p-loc-${holding}`}
              name="location"
              defaultValue={property ? fmtLatLng(property) : undefined}
              placeholder="10.4012, 107.2345"
              required
            />
            <p className="text-caption text-muted-foreground">{LOCATION_HINT}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`p-area-${holding}`}>Area (m²)</Label>
            <Input id={`p-area-${holding}`} name="area_m2" type="number" min="1" step="0.1" defaultValue={property?.area_m2} placeholder="120" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`p-radius-${holding}`}>Comps within (km)</Label>
            <Input id={`p-radius-${holding}`} name="radius_km" type="number" min="0.1" max="50" step="0.1" defaultValue={property?.radius_km ?? 3} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`p-use-${holding}`}>Land use</Label>
            <EnumSelect id={`p-use-${holding}`} name="land_use" labels={LAND_USE_LABELS} defaultValue={property?.land_use ?? "residential"} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`p-access-${holding}`}>Road access</Label>
            <EnumSelect id={`p-access-${holding}`} name="access" labels={ROAD_ACCESS_LABELS} defaultValue={property?.access ?? "alley"} />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={`p-auto-${holding}`}>Auto-update comps</Label>
            <EnumSelect
              id={`p-auto-${holding}`}
              name="auto_comps"
              labels={AUTO_COMPS_LABELS}
              defaultValue={String(property?.auto_comps ?? 10)}
            />
            <p className="text-caption text-muted-foreground">
              Once a day, keeps the nearest Nhà Tốt listings with the same land use as comps,
              replacing the previous set. Comps you added or ticked in yourself are never touched.
            </p>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={`p-note-${holding}`}>Note (optional)</Label>
            <Input id={`p-note-${holding}`} name="note" defaultValue={property?.note ?? undefined} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant={property ? "default" : "outline"} disabled={pending}>
              {pending ? "Saving…" : property ? "Update location" : "Save location"}
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Edits `comp`, or adds a new comp to `holding`'s evidence — comps belong to one plot. */
function CompForm({
  comp, holding, onDone,
}: { comp?: PropertyComp; holding?: string; onDone?: () => void }) {
  const [price, setPrice] = React.useState(comp?.price ?? 0);
  const [area, setArea] = React.useState(comp?.area_m2 ?? 0);
  const today = new Date().toLocaleDateString("sv-SE");
  const id = comp ? `c${comp.id}` : "c-new";

  return (
    <ActionForm
      action={comp ? (fd) => updateComp(comp.id, fd) : (fd) => addComp(holding ?? "", fd)}
      resetOnOk={!comp}
      onDone={onDone}
      className="grid gap-4 sm:grid-cols-2"
    >
      {(pending) => (
        <>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={`${id}-loc`}>Location</Label>
            <Input id={`${id}-loc`} name="location" defaultValue={comp ? fmtLatLng(comp) : undefined} placeholder="10.4012, 107.2345" required />
            <p className="text-caption text-muted-foreground">{LOCATION_HINT}</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-price`}>Price for the whole plot (VND)</Label>
            <CurrencyInput id={`${id}-price`} name="price" defaultValue={comp?.price} placeholder="1.500.000.000" onValueChange={setPrice} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-area`}>Area (m²)</Label>
            <Input
              id={`${id}-area`} name="area_m2" type="number" min="1" step="0.1"
              defaultValue={comp?.area_m2} placeholder="100" required
              onChange={(e) => setArea(Number(e.currentTarget.value) || 0)}
            />
          </div>
          <p className="-mt-2 text-caption text-muted-foreground sm:col-span-2">
            {price > 0 && area > 0 ? <>≈ <span className="font-mono">{fmtPerM2(price / area)}</span></> : "Listings often quote per m²: multiply by the area."}
          </p>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-kind`}>Price type</Label>
            <EnumSelect id={`${id}-kind`} name="kind" labels={COMP_KIND_LABELS} defaultValue={comp?.kind ?? "asking"} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-date`}>Date seen</Label>
            <Input id={`${id}-date`} name="date" type="date" defaultValue={comp?.date ?? today} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-use`}>Land use</Label>
            <EnumSelect id={`${id}-use`} name="land_use" labels={LAND_USE_LABELS} defaultValue={comp?.land_use ?? "residential"} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-access`}>Road access</Label>
            <EnumSelect id={`${id}-access`} name="access" labels={ROAD_ACCESS_LABELS} defaultValue={comp?.access ?? "alley"} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-label`}>Label (optional)</Label>
            <Input id={`${id}-label`} name="label" defaultValue={comp?.label ?? undefined} placeholder="e.g. Alley 12, near the market" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-source`}>Source link (optional)</Label>
            <Input id={`${id}-source`} name="source" type="url" defaultValue={comp?.source ?? undefined} placeholder="https://…" />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={`${id}-note`}>Note (optional)</Label>
            <Input id={`${id}-note`} name="note" defaultValue={comp?.note ?? undefined} />
          </div>
          <p className="text-caption text-muted-foreground sm:col-span-2">
            Asking prices are counted at {Math.round((1 - ASKING_DISCOUNT) * 100)}% — listings
            here typically ask 10–20% over what land sells for. A price someone actually
            paid counts in full.
          </p>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : comp ? "Update comp" : "Add comp"}
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function AddCompDialog({ holding }: { holding: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="size-3.5" />
        Add comp
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a comparable plot</DialogTitle>
        </DialogHeader>
        <CompForm holding={holding} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

// ---------- the comp map ----------

/**
 * Your plot at the centre and every comp inside its radius around it, north up, drawn to
 * scale. Not a map: there are no tiles to fetch and nothing to key, and what matters here is
 * only where the evidence sits relative to you. A comp's dot grows with the weight it carries;
 * one filtered out by land use is drawn hollow, so you can see why it isn't counting.
 */
export function CompRadar({ property, scored }: { property: Property; scored: ScoredComp[] }) {
  const R = 100;
  const inside = scored.filter((s) => s.distanceKm < property.radius_km && s.excluded !== "future");
  const maxW = Math.max(...inside.map((s) => s.weight), 0);

  return (
    <svg viewBox="-120 -120 240 240" className="mx-auto w-full max-w-[280px]" role="img" aria-label={`Comps within ${property.radius_km} km`}>
      {[1, 0.5].map((f) => (
        <g key={f}>
          <circle r={R * f} fill="none" stroke="var(--grid-strong)" strokeDasharray={f === 1 ? undefined : "3 3"} />
          <text x={R * f - 3} y={-4} fontSize={10} textAnchor="end" fill="var(--muted-foreground)">
            {fmtKm(property.radius_km * f)}
          </text>
        </g>
      ))}
      <text x={0} y={-R - 6} fontSize={10} textAnchor="middle" fill="var(--muted-foreground)">N</text>
      {inside.map((s) => {
        const { x, y } = offsetKm(property, s.comp);
        const k = R / property.radius_km;
        const used = s.weight > 0;
        const r = used && maxW > 0 ? 3 + 6 * Math.sqrt(s.weight / maxW) : 4;
        return (
          <circle
            key={s.comp.id}
            cx={x * k}
            cy={-y * k}
            r={r}
            fill={used ? "var(--chart-4)" : "none"}
            fillOpacity={used ? 0.75 : 0}
            stroke={used ? "var(--chart-4)" : "var(--muted-foreground)"}
            strokeWidth={1.25}
          >
            <title>
              {`${s.comp.label ?? fmtLatLng(s.comp)} · ${fmtKm(s.distanceKm)} · ${fmtPerM2(s.perM2)}${s.excluded ? ` · not counted (${s.excluded})` : ""}`}
            </title>
          </circle>
        );
      })}
      <path d="M0 -7 L7 0 L0 7 L-7 0 Z" fill="var(--foreground)" />
    </svg>
  );
}

// ---------- one property ----------

export function basisLine(v: Valuation, property: Property, anchor: Anchor | null, hasIndex: boolean): string {
  const within = `within ${property.radius_km} km`;
  const comps = `${v.used} comp${v.used === 1 ? "" : "s"} ${within}`;
  const paid = hasIndex ? "what you paid, carried forward by the area index" : "what you paid";
  switch (v.method) {
    case "comps":
      return `From ${comps}. No purchase recorded to anchor it to.`;
    case "blend":
      return `${Math.round(v.compShare * 100)}% from ${comps}, ${Math.round((1 - v.compShare) * 100)}% from ${paid}. Each added comp shifts it further toward the market.`;
    case "index":
      return `No comps ${within} yet. This is what you paid (${fmtVND(anchor?.cost ?? 0)}), carried forward by the area index.`;
    case "cost":
    case "none":
      return `Nothing to predict from yet: no comps ${within}. Find listings nearby, or add a sale you know of.`;
  }
}

export const CONFIDENCE_BADGE = {
  high: { variant: "accent", label: "High confidence" },
  medium: { variant: "secondary", label: "Medium confidence" },
  low: { variant: "warning", label: "Low confidence" },
} as const;

type FoundListing = Listing & { added: boolean };

/**
 * Nhà Tốt listings around the plot, to tick into comps. The search runs when the dialog
 * opens — a deliberate press, never on page load — and pre-ticks the ones that would count:
 * same land use, not already added. A different land use stays visible but unticked, since
 * seeing the agricultural plot next door priced at a tenth of yours is useful in itself.
 */
export function FindListingsDialog({ property }: { property: Property }) {
  const [open, setOpen] = React.useState(false);
  const [found, setFound] = React.useState<FoundListing[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<Set<number>>(new Set());
  const [searching, startSearch] = React.useTransition();
  const [saving, startSave] = React.useTransition();

  const search = () =>
    startSearch(async () => {
      setError(null);
      const res = await findListings(property.instrument);
      if (!res.ok) {
        setFound(null);
        setError(res.message);
        return;
      }
      setFound(res.listings);
      setPicked(new Set(res.listings.filter((l) => !l.added && l.land_use === property.land_use).map((l) => l.id)));
    });

  const toggle = (id: number, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) search();
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <Search className="size-3.5" />
        Find listings nearby
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Land for sale within {property.radius_km} km</DialogTitle>
        </DialogHeader>
        <p className="text-caption text-muted-foreground">
          Asking prices from Nhà Tốt, counted at {Math.round((1 - ASKING_DISCOUNT) * 100)}%. Tick
          the plots that are genuinely like yours. A listing that&apos;s a different land use
          won&apos;t count toward the estimate.
        </p>

        {searching && (
          <div className="flex items-center gap-2 py-8 text-body-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Searching…
          </div>
        )}
        {!searching && error && <p className="py-4 text-body-sm text-destructive">{error}</p>}
        {!searching && found && found.length === 0 && (
          <p className="py-4 text-body-sm text-muted-foreground">
            Nothing listed within {property.radius_km} km right now. Widen the radius on the
            location, or check back later.
          </p>
        )}
        {!searching && found && found.length > 0 && (
          <ul className="-mx-1 grid min-w-0 max-h-[55vh] grid-cols-[minmax(0,1fr)] gap-1 overflow-y-auto px-1">
            {found.map((l) => {
              const other = l.land_use !== property.land_use;
              return (
                <li key={l.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-pane",
                      (l.added || other) && "text-muted-foreground",
                    )}
                  >
                    <Checkbox
                      className="mt-1"
                      checked={picked.has(l.id)}
                      disabled={l.added}
                      onCheckedChange={(on) => toggle(l.id, on)}
                      aria-label={l.title}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body-sm">{l.title}</div>
                      <div className="text-caption text-muted-foreground tabular-nums">
                        {fmtKm(l.distanceKm)} · {l.place || fmtLatLng(l)} · {l.date}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="tag">{LAND_USE_LABELS[l.land_use]}</Badge>
                        {l.access === "street" && <Badge variant="tag">Street front</Badge>}
                        {l.added && <Badge variant="secondary">Added</Badge>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-body-sm tabular-nums">{fmtPerM2(l.price / l.area_m2)}</div>
                      <div className="text-caption text-muted-foreground tabular-nums">
                        <span className="font-mono">{fmtVND(l.price)}</span> · {l.area_m2.toLocaleString("de-DE")} m²
                      </div>
                      <a
                        href={l.url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-caption underline-offset-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Listing <ExternalLink className="size-3" />
                      </a>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {found && found.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-caption text-muted-foreground">
              {found.length} listing{found.length === 1 ? "" : "s"} · {picked.size} ticked
            </span>
            <Button
              disabled={saving || searching || picked.size === 0}
              onClick={() =>
                startSave(async () => {
                  const res = await importListings(property.instrument, [...picked]);
                  if (res.ok) {
                    toast.success(res.message);
                    setOpen(false);
                  } else toast.error(res.message);
                })
              }
            >
              {saving ? "Adding…" : `Add ${picked.size} as comp${picked.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Every value booked for this holding, newest first. Each one applies from its date until
 * the next, which is how the P&L history now values the plot — and deleting one is the undo:
 * the holding goes back to the booking before it. The initial row is what the plot was
 * carried at before any booking, so it has no undo of its own.
 */
export function ValuationList({ holding, rows }: { holding: string; rows: PropertyValuation[] }) {
  const [pending, startTransition] = React.useTransition();
  const newestFirst = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="flex flex-col gap-3 card-surface panel-body">
      <PanelHead
        title="Booked values"
        info="What net worth has counted this plot at, and from when. Each value applies from its date until the next; undoing one puts the plot back on the one before."
      />
      {rows.length === 0 && (
        <p className="text-body-sm text-muted-foreground">
          Nothing booked yet. Net worth counts the value set on the holding.
        </p>
      )}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
        {newestFirst.map((r, i) => (
          <li key={r.date} className="flex items-center justify-between gap-3 text-body-sm">
            <div className="min-w-0">
              <div className="tabular-nums">
                {r.date}
                {i === 0 && <Badge variant="accent" className="ml-2">Current</Badge>}
              </div>
              <div className="text-caption text-muted-foreground">{VALUATION_SOURCE_LABELS[r.source]}</div>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-mono tabular-nums">{fmtVND(r.value)}</span>
              {r.source === "initial" ? (
                <span className="size-8" aria-hidden />
              ) : (
                <IconTooltip label="Undo this booking">
                  <Button
                    variant="ghost" size="icon-sm" aria-label={`Undo the ${r.date} booking`} disabled={pending}
                    onClick={() => {
                      if (!confirm(`Undo the ${fmtVND(r.value)} booking from ${r.date}? The value goes back to the one before it.`)) return;
                      startTransition(async () => {
                        const res = await deleteValuation(holding, r.date);
                        if (res.ok) toast.success(res.message);
                        else toast.error(res.message);
                      });
                    }}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </IconTooltip>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The location form in a dialog, with the one way to forget a plot's location. */
export function EditLocationDialog({ holding, property }: { holding: string; property: Property }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <IconTooltip label="Edit location">
        <DialogTrigger render={<Button variant="ghost" size="icon" aria-label="Edit location" />}>
          <Pencil className="size-4" />
        </DialogTrigger>
      </IconTooltip>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{holding}: location</DialogTitle>
        </DialogHeader>
        <PropertyForm holding={holding} property={property} onDone={() => setOpen(false)} />
        <Button
          variant="ghost"
          className="justify-self-start text-destructive"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Forget where ${holding} is? Its value, bookings and transactions stay.`)) return;
            startTransition(async () => {
              const res = await deleteProperty(holding);
              if (res.ok) toast.success(res.message);
              else toast.error(res.message);
              setOpen(false);
            });
          }}
        >
          Remove location
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** Book the estimate's low end as the plot's value, dated today. */
export function BookLowEndButton({ holding, disabled }: { holding: string; disabled: boolean }) {
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending || disabled}
      onClick={() =>
        startTransition(async () => {
          const res = await applyEstimate(holding);
          if (res.ok) toast.success(res.message);
          else toast.error(res.message);
        })
      }
    >
      Book the low end
    </Button>
  );
}

export function IndexPanel({ holding, points }: { holding: string; points: PropertyIndexPoint[] }) {
  const [pending, startTransition] = React.useTransition();
  const today = new Date().toLocaleDateString("sv-SE");
  return (
    <section className="flex flex-col gap-3 card-surface panel-body">
      <PanelHead
        title="Area index"
        info="Any consistent price series for the area around this plot, e.g. the district's average ₫/m² from a listing site's price page. Only the change between two dates is used, so the unit doesn't matter as long as it stays the same."
      />
      <div className="grid gap-3">
        <p className="text-caption text-muted-foreground">
          Optional. Carries old comps and what you paid forward to today.
          {points.length === 0 && " No readings yet."}
        </p>
        {points.length > 0 && (
          <ul className="grid gap-1 text-body-sm">
            {points.map((p) => (
              <li key={p.date} className="flex items-center justify-between gap-3">
                <span className="tabular-nums">{p.date}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.source}</span>
                <span className="tabular-nums">{p.level.toLocaleString("de-DE")}</span>
                <Button
                  variant="ghost" size="icon-sm" aria-label={`Delete the ${p.date} reading`} disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await deleteIndexPoint(holding, p.date);
                      if (res.ok) toast.success(res.message);
                      else toast.error(res.message);
                    })
                  }
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={(fd) => addIndexPoint(holding, fd)} resetOnOk className="grid grid-cols-2 gap-2">
          {(busy) => (
            <>
              <Input name="date" type="date" defaultValue={today} aria-label="Reading date" required />
              <Input name="level" type="number" min="0" step="any" placeholder="Level" aria-label="Index level" required />
              <Input name="source" placeholder="Source (optional)" aria-label="Source" className="col-span-2" />
              <Button type="submit" variant="outline" disabled={busy} className="col-span-2 justify-self-start">Add reading</Button>
            </>
          )}
        </ActionForm>
      </div>
    </section>
  );
}

// ---------- a comp's row actions ----------

export function CompActions({ comp }: { comp: PropertyComp }) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  return (
    <div className="flex justify-end gap-1">
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <IconTooltip label="Edit comp">
          <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit comp" />}>
            <Pencil className="size-3.5" />
          </DialogTrigger>
        </IconTooltip>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit comp</DialogTitle>
          </DialogHeader>
          <CompForm comp={comp} onDone={() => setEditOpen(false)} />
        </DialogContent>
      </Dialog>
      <IconTooltip label="Delete comp">
        <Button
          variant="ghost" size="icon-sm" aria-label="Delete comp" disabled={pending}
          onClick={() => {
            if (!confirm(`Delete the ${fmtVND(comp.price)} comp${comp.label ? ` at ${comp.label}` : ""}?`)) return;
            startTransition(async () => {
              const res = await deleteComp(comp.id);
              if (res.ok) toast.success(res.message);
              else toast.error(res.message);
            });
          }}
        >
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </IconTooltip>
    </div>
  );
}

