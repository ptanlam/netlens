"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronLeft, ExternalLink, MapPin } from "lucide-react";
import {
  LAND_USE_LABELS, ROAD_ACCESS_LABELS,
  type Property, type PropertyComp, type PropertyIndexPoint, type PropertyValuation,
} from "@/lib/types";
import { fmtVND } from "@/lib/format";
import {
  estimate, fmtLatLng, hasPrediction, listingId, mapsUrl, type Anchor, type ScoredComp,
} from "@/lib/realestate";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { PanelHead } from "@/components/panel-head";
import { SummaryCards } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  AddCompDialog, BookLowEndButton, CONFIDENCE_BADGE, CompActions, CompRadar, EditLocationDialog,
  FindListingsDialog, IndexPanel, PropertyForm, RefreshPricesButton, ValuationList, basisLine,
  fmtKm, fmtPerM2,
  type EstateHolding,
} from "@/components/real-estate-parts";

/** One of this plot's comps, with the share of the estimate it carries (0 when it doesn't count). */
type PlotComp = ScoredComp & { share: number };

const EXCLUDED_LABEL = {
  "land use": "Different land use",
  future: "Dated in the future",
} as const;

const compColumns: ColumnDef<PlotComp>[] = [
  {
    id: "comp",
    header: "Comp",
    enableSorting: false,
    size: 260,
    cell: ({ row }) => {
      const c = row.original.comp;
      return (
        <div className="min-w-0">
          <div className="truncate font-semibold">
            {c.source ? (
              <a href={c.source} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                {c.label ?? "Listing"}
              </a>
            ) : (c.label ?? "Comp")}
          </div>
          <div className="truncate text-caption text-muted-foreground">
            {c.kind === "sale" ? "Sold" : "Asking"}
            {c.delisted_on && ` · no longer listed since ${c.delisted_on}`}
            {" · "}{c.note ?? fmtLatLng(c)}
          </div>
        </div>
      );
    },
  },
  {
    id: "distance",
    header: "Distance",
    accessorFn: (r) => r.distanceKm,
    size: 130,
    meta: { align: "right" },
    cell: ({ row }) => <span className="tabular-nums">{fmtKm(row.original.distanceKm)}</span>,
  },
  {
    id: "date",
    header: "Date",
    accessorFn: (r) => r.comp.date,
    size: 130,
    cell: ({ row }) => <span className="tabular-nums">{row.original.comp.date}</span>,
  },
  {
    id: "perM2",
    header: "₫/m²",
    accessorFn: (r) => r.perM2,
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) => (
      <div className="text-right">
        <div className="font-mono tabular-nums">{fmtVND(Math.round(row.original.perM2))}</div>
        <div className="text-caption text-muted-foreground tabular-nums">
          {row.original.comp.area_m2.toLocaleString("de-DE")} m²
        </div>
      </div>
    ),
  },
  {
    id: "weight",
    header: "Weight",
    accessorFn: (r) => r.share,
    size: 130,
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.excluded ? (
        <span className="text-caption text-muted-foreground">{EXCLUDED_LABEL[row.original.excluded]}</span>
      ) : (
        <span className="tabular-nums">{Math.round(row.original.share * 100)}%</span>
      ),
  },
  {
    id: "actions",
    header: "",
    enableSorting: false,
    size: 90,
    cell: ({ row }) => <CompActions comp={row.original.comp} />,
  },
];

function BackLink() {
  return (
    <Link
      href="/real-estate"
      className="inline-flex w-fit items-center gap-1 text-body-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-4" />
      Real estate
    </Link>
  );
}

/**
 * One plot: what it's predicted to be worth, the evidence behind that, and what's been
 * booked for it. A plot with no location yet shows the form that places it instead.
 */
export function RealEstateDetail({
  holding,
  property,
  comps,
  index,
  anchor,
  valuations,
  today,
}: {
  holding: EstateHolding;
  property: Property | null;
  comps: PropertyComp[];
  index: PropertyIndexPoint[];
  anchor: Anchor | null;
  valuations: PropertyValuation[];
  /** Fixed by the server — every comp is aged against it. */
  today: string;
}) {
  const v = React.useMemo(
    () => (property ? estimate(property, comps, index, anchor, today) : null),
    [property, comps, index, anchor, today],
  );

  if (!property || !v) {
    return (
      <div className="flex flex-col gap-3 sm:gap-4">
        <BackLink />
        <PageHeader title={holding.name}>
          Where is it? Once the app knows the location and size of the plot, it can price it
          from comparable plots nearby.
        </PageHeader>
        <section className="card-surface panel-body">
          <PropertyForm holding={holding.name} />
        </section>
      </div>
    );
  }

  const predicted = hasPrediction(v);
  const used = v.scored.filter((s) => s.weight > 0);
  const totalW = used.reduce((a, s) => a + s.weight, 0);
  const rows: PlotComp[] = v.scored.map((s) => ({ ...s, share: totalW > 0 ? s.weight / totalW : 0 }));
  const booked = holding.value;
  const diff = v.low - booked;
  const conf = CONFIDENCE_BADGE[v.confidence];

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <BackLink />
      <PageHeader
        title={holding.name}
        actions={
          <>
            <EditLocationDialog holding={holding.name} property={property} />
            <FindListingsDialog property={property} />
            <RefreshPricesButton
              holding={holding.name}
              disabled={!comps.some((c) => listingId(c.source) != null)}
            />
            <BookLowEndButton holding={holding.name} disabled={!predicted || v.low === booked} />
            <AddCompDialog holding={holding.name} />
          </>
        }
      >
        {/* Plain text, not tag chips: a tag is `bg-pane`, the same sage as the page, so on
            the page itself it has no edge at all. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            {LAND_USE_LABELS[property.land_use]} · {ROAD_ACCESS_LABELS[property.access]} ·{" "}
            {property.area_m2.toLocaleString("de-DE")} m²
          </span>
          {predicted && <Badge variant={conf.variant}>{conf.label}</Badge>}
          <a
            href={mapsUrl(property)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-caption underline-offset-2 hover:underline"
          >
            <MapPin className="size-3" />
            {fmtLatLng(property)}
            <ExternalLink className="size-3" />
          </a>
        </div>
      </PageHeader>

      <SummaryCards
        stats={predicted ? [
          { label: "Estimate", value: fmtVND(v.mid), sub: fmtPerM2(v.perM2) },
          {
            label: "Range",
            value: v.low === v.high ? "—" : fmtVND(v.low),
            sub: v.low === v.high ? "No comps to spread it" : `to ${fmtVND(v.high)}`,
          },
          {
            label: "Booked in net worth",
            value: fmtVND(booked),
            sub: diff === 0 ? "Matches the low end" : `Low end is ${diff > 0 ? "+" : "−"}${fmtVND(Math.abs(diff))}`,
          },
        ] : [
          { label: "Estimate", value: "No prediction yet", sub: "No comps with the same land use", unmask: true },
          {
            label: "What you paid",
            value: anchor ? fmtVND(anchor.cost) : "—",
            sub: anchor ? `Since ${anchor.date}` : "No purchase recorded",
          },
          { label: "Booked in net worth", value: fmtVND(booked), sub: "What net worth counts today" },
        ]}
      />

      <section className="flex flex-col gap-4 card-surface panel-body">
        <PanelHead
          title="Prediction"
          info="The weighted median ₫/m² of nearby comps × your area, shrunk toward what you paid while the evidence is thin. The range is the comps' middle half. Net worth only moves when you book a value."
        />
        <p className="text-body-sm text-muted-foreground">{basisLine(v, property, anchor, index.length > 0)}</p>
        <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)] md:items-start">
          <CompRadar property={property} scored={v.scored} />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="text-body-sm font-semibold">Carrying the most weight</div>
            {used.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">
                No comps count yet. Use <span className="font-semibold text-foreground">Find listings nearby</span>,
                or add a plot with the same land use yourself.
              </p>
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
                {used.slice(0, 5).map((s) => (
                  <li key={s.comp.id} className="flex items-center justify-between gap-3 text-body-sm">
                    <div className="min-w-0">
                      <div className="truncate">{s.comp.label ?? fmtLatLng(s.comp)}</div>
                      <div className="text-caption text-muted-foreground tabular-nums">
                        {fmtKm(s.distanceKm)} · {s.comp.date} · {s.comp.kind === "sale" ? "sold" : "asking"}
                        {s.comp.access !== property.access && " · different road"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono tabular-nums">{fmtPerM2(s.perM2)}</div>
                      <div className="text-caption text-muted-foreground tabular-nums">
                        {Math.round((s.weight / totalW) * 100)}% weight
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 overflow-hidden card-surface panel-body">
        <PanelHead
          title={`Comps · ${rows.length}`}
          info={`Every comp you added to this plot counts, with the share of the estimate it carries: nearer, fresher and more alike count more — one ${property.radius_km} km out counts half as much as one next door. Comps aren't shared between plots. ₫/m² is as counted: asking prices discounted, old comps carried forward by the area index. Only a different land use keeps a comp out.`}
        />
        <DataTable
          columns={compColumns}
          data={rows}
          initialSorting={[{ id: "weight", desc: true }]}
          pageSize={rows.length > 20 ? 20 : undefined}
          emptyMessage="No comps for this plot yet."
          storageKey="real-estate-plot-comps"
        />
      </section>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2 lg:items-start">
        <ValuationList holding={holding.name} rows={valuations} />
        <IndexPanel holding={holding.name} points={index} />
      </div>
    </div>
  );
}
