"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { ASSET_TYPES, type Instrument } from "@/lib/types";
import { saveHoldings } from "@/app/actions";
import { fmtVND } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { Input } from "@/components/ui/input";
import { RefreshPricesButton } from "@/components/live-prices";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface HoldingRow {
  inst: Instrument;
  value: number;
  idx: number;
}

const makeColumns = (sources: string[]): ColumnDef<HoldingRow>[] => [
  {
    id: "instrument",
    header: "Instrument",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="font-medium">
        {row.original.inst.name}
        <input type="hidden" name={`inst_${row.original.idx}`} value={row.original.inst.name} />
      </span>
    ),
  },
  {
    id: "type",
    header: "Type",
    enableSorting: false,
    cell: ({ row }) => (
      <Select name={`type_${row.original.idx}`} defaultValue={row.original.inst.asset_type}>
        <SelectTrigger size="sm" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ASSET_TYPES.map((t) => (
            <SelectItem key={t} value={t}>{t}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
  },
  {
    id: "source",
    header: "Price source",
    enableSorting: false,
    cell: ({ row }) => (
      <Select name={`source_${row.original.idx}`} defaultValue={row.original.inst.price_source}>
        <SelectTrigger size="sm" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sources.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    ),
  },
  {
    id: "symbol",
    header: "Symbol",
    enableSorting: false,
    cell: ({ row }) => (
      <Input name={`symbol_${row.original.idx}`} defaultValue={row.original.inst.symbol ?? ""} className="h-8 w-28" />
    ),
  },
  {
    id: "quantity",
    header: "Quantity",
    enableSorting: false,
    cell: ({ row }) => (
      <Input
        name={`qty_${row.original.idx}`}
        type="number"
        step="any"
        defaultValue={row.original.inst.quantity ?? ""}
        className="h-8 w-28"
      />
    ),
  },
  {
    id: "manual",
    header: "Manual value (VND)",
    enableSorting: false,
    cell: ({ row }) => (
      <Input
        name={`manual_${row.original.idx}`}
        type="number"
        step="1"
        defaultValue={row.original.inst.manual_value ?? ""}
        className="h-8 w-36"
      />
    ),
  },
  {
    id: "last_price",
    header: "Last price",
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        {row.original.inst.last_price != null ? row.original.inst.last_price.toLocaleString() : "—"}
      </span>
    ),
  },
  {
    id: "value",
    header: "Value",
    enableSorting: false,
    meta: { align: "right" },
    cell: ({ row }) => {
      const { inst, value } = row.original;
      return (
        <span className="font-mono tabular-nums">
          {value ? fmtVND(value) : "—"}{" "}
          {inst.quantity != null && inst.last_price != null && (
            <Badge className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">live</Badge>
          )}
        </span>
      );
    },
  },
];

export function HoldingsForm({
  rows,
  sources,
}: {
  rows: { inst: Instrument; value: number }[];
  sources: string[];
}) {
  const [pending, startTransition] = React.useTransition();
  const data = React.useMemo<HoldingRow[]>(
    () => rows.map((r, idx) => ({ ...r, idx })),
    [rows],
  );
  const columns = React.useMemo(() => makeColumns(sources), [sources]);

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await saveHoldings(fd);
          if (res.ok) toast.success(res.message);
          else toast.error(res.message);
        })
      }
    >
      <input type="hidden" name="rows" value={rows.length} />
      <DataTable columns={columns} data={data} emptyMessage="No holdings yet." />
      <div className="mt-4 flex items-center justify-between">
        <RefreshPricesButton />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save holdings"}
        </Button>
      </div>
    </form>
  );
}
