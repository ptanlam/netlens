"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import { LAND_USE_LABELS } from "@/lib/types";
import { fmtVND } from "@/lib/format";
import { estateHref, hasPrediction, type EstateRow } from "@/lib/realestate";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { PanelHead } from "@/components/panel-head";
import { SummaryCards } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { CONFIDENCE_BADGE } from "@/components/real-estate-parts";

/** A row's prediction, if it has one — what you paid unmoved isn't. */
function predictedMid(r: EstateRow): number | null {
  return r.valuation && hasPrediction(r.valuation) ? r.valuation.mid : null;
}

const columns: ColumnDef<EstateRow>[] = [
  {
    id: "plot",
    header: "Plot",
    accessorKey: "name",
    size: 230,
    cell: ({ row }) => {
      const r = row.original;
      return (
        <div className="min-w-0">
          <Link href={estateHref(r.name)} className="font-semibold underline-offset-2 hover:underline">
            {r.name}
          </Link>
          <div className="truncate text-caption text-muted-foreground tabular-nums">
            {r.property
              ? `${LAND_USE_LABELS[r.property.land_use]} · ${r.property.area_m2.toLocaleString("de-DE")} m²`
              : "Not placed yet"}
          </div>
        </div>
      );
    },
  },
  {
    id: "booked",
    header: "Booked",
    accessorKey: "booked",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) => <span className="font-mono tabular-nums">{fmtVND(row.original.booked)}</span>,
  },
  {
    id: "estimate",
    header: "Estimate",
    accessorFn: (r) => predictedMid(r) ?? -1,
    size: 220,
    meta: { align: "right" },
    cell: ({ row }) => {
      const r = row.original;
      const mid = predictedMid(r);
      if (mid == null) return <span className="text-muted-foreground">No prediction</span>;
      const v = r.valuation!;
      return (
        <div className="text-right">
          <div className="font-mono tabular-nums">{fmtVND(mid)}</div>
          {v.low !== v.high && (
            <div className="font-mono text-caption text-muted-foreground tabular-nums">
              {fmtVND(v.low)} – {fmtVND(v.high)}
            </div>
          )}
        </div>
      );
    },
  },
  {
    id: "diff",
    header: "vs booked",
    accessorFn: (r) => {
      const mid = predictedMid(r);
      return mid == null ? 0 : mid - r.booked;
    },
    size: 140,
    meta: { align: "right" },
    cell: ({ row }) => {
      const mid = predictedMid(row.original);
      if (mid == null) return <span className="text-muted-foreground">—</span>;
      const d = mid - row.original.booked;
      return (
        <span className={cn("font-mono tabular-nums", d > 0 ? "text-accent-brand" : d < 0 && "text-destructive")}>
          {d > 0 ? "+" : d < 0 ? "−" : ""}{fmtVND(Math.abs(d))}
        </span>
      );
    },
  },
  {
    id: "evidence",
    header: "Evidence",
    accessorFn: (r) => r.valuation?.used ?? 0,
    size: 170,
    cell: ({ row }) => {
      const v = row.original.valuation;
      if (!v || predictedMid(row.original) == null) return <span className="text-muted-foreground">—</span>;
      const conf = CONFIDENCE_BADGE[v.confidence];
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={conf.variant}>{conf.label.replace(" confidence", "")}</Badge>
          <span className="text-caption text-muted-foreground tabular-nums">
            {v.used} comp{v.used === 1 ? "" : "s"}
          </span>
        </div>
      );
    },
  },
  {
    id: "open",
    header: "",
    enableSorting: false,
    size: 48,
    cell: ({ row }) => (
      <Link
        href={estateHref(row.original.name)}
        aria-label={`Open ${row.original.name}`}
        className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-pane hover:text-foreground"
      >
        <ChevronRight className="size-4" />
      </Link>
    ),
  },
];

/**
 * Every Real Estate holding in one table — what net worth books it at beside what it's
 * predicted to be worth — with each row opening its details page, where its comps live.
 */
export function RealEstateList({ rows }: { rows: EstateRow[] }) {
  const booked = rows.reduce((a, r) => a + r.booked, 0);
  const predicted = rows.reduce((a, r) => a + (predictedMid(r) ?? r.booked), 0);
  const withPrediction = rows.filter((r) => predictedMid(r) != null).length;
  const diff = predicted - booked;

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PageHeader title="Real estate">
        What your land is worth, estimated from comparable plots near it: listings you pull in
        from Nhà Tốt, or sales you add yourself. Open a plot for its evidence.
      </PageHeader>

      <SummaryCards
        stats={[
          { label: "Booked in net worth", value: fmtVND(booked), sub: "What net worth counts today" },
          {
            label: "Predicted",
            value: fmtVND(predicted),
            sub: diff === 0 ? "Matches what's booked" : `${diff > 0 ? "+" : "−"}${fmtVND(Math.abs(diff))} vs booked`,
            tone: diff > 0 ? "gain" : diff < 0 ? "loss" : undefined,
          },
          {
            label: "Plots",
            value: String(rows.length),
            unmask: true,
            sub: `${withPrediction} with a prediction`,
          },
        ]}
      />

      <section className="flex flex-col gap-3 overflow-hidden card-surface panel-body">
        <PanelHead
          title="Plots"
          info="Each Real Estate holding. Booked is what net worth counts; the estimate is the middle of the prediction, with its range beneath. Add a holding on Investments with the asset type Real Estate to see it here."
        />
        <DataTable
          columns={columns}
          data={rows}
          initialSorting={[{ id: "booked", desc: true }]}
          emptyMessage="No Real Estate holdings yet. Add one on Investments with the asset type Real Estate."
          storageKey="real-estate-plots"
        />
      </section>

    </div>
  );
}
