"use client";

import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { Tx } from "@/lib/types";
import { fmtUnits, fmtVND } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { TxRowActions } from "@/components/tx-row-actions";
import type { InstrumentOption } from "@/components/tx-form";
import { cn } from "@/lib/utils";

export function TransactionsTable({
  transactions,
  instruments,
}: {
  transactions: Tx[];
  instruments: InstrumentOption[];
}) {
  const columns = React.useMemo<ColumnDef<Tx>[]>(
    () => [
      {
        accessorKey: "date",
        header: "Date",
        size: 110,
        cell: ({ row }) => <span className="tabular-nums whitespace-nowrap">{row.original.date}</span>,
      },
      {
        accessorKey: "asset_type",
        header: "Type",
        size: 100,
        cell: ({ row }) => <Badge variant="secondary">{row.original.asset_type}</Badge>,
      },
      {
        accessorKey: "instrument",
        header: "Instrument",
        size: 200,
      },
      {
        accessorKey: "amount",
        header: "Amount",
        size: 140,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className={cn("font-mono tabular-nums", row.original.amount < 0 && "text-(--chart-negative)")}>
            {fmtVND(row.original.amount)}
          </span>
        ),
      },
      {
        accessorKey: "quantity",
        header: "Quantity",
        size: 130,
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.quantity != null ? fmtUnits(row.original.quantity) : "—"}</span>
        ),
      },
      {
        accessorKey: "note",
        header: "Note",
        enableSorting: false,
        size: 240,
        cell: ({ row }) => (
          <span className="block max-w-48 truncate text-muted-foreground">{row.original.note}</span>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        size: 110,
        cell: ({ row }) => <TxRowActions tx={row.original} instruments={instruments} />,
      },
    ],
    [instruments],
  );

  return (
    <DataTable
      columns={columns}
      data={transactions}
      initialSorting={[{ id: "date", desc: true }]}
      pageSize={20}
      emptyMessage="No transactions yet."
      storageKey="transactions"
    />
  );
}
