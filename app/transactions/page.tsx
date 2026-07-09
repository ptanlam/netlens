import { connection } from "next/server";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import * as db from "@/lib/db";
import { fmtVND } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TxRowActions } from "@/components/tx-row-actions";
import { AddTxDialog } from "@/components/add-tx-dialog";
import { PendingUnitsCard } from "@/components/pending-units";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await connection();
  db.materializeRecurring();
  const txs = db.allTransactions();
  const instruments = db.instrumentNames();
  const pending = db.pendingFundUnits().map((tx) => {
    const inst = db.getInstrument(tx.instrument);
    return {
      tx,
      window: db.expectedUnitsWindow(tx.date),
      estUnits:
        inst?.last_price ? Number((tx.amount / inst.last_price).toFixed(2)) : null,
      hasHoldingQty: inst?.quantity != null,
    };
  });

  const totalPages = Math.max(1, Math.ceil(txs.length / PAGE_SIZE));
  const requested = Number((await searchParams).page);
  const page = Math.min(
    Math.max(Number.isFinite(requested) ? Math.trunc(requested) : 1, 1),
    totalPages,
  );
  const start = (page - 1) * PAGE_SIZE;
  const pageTxs = txs.slice(start, start + PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      {pending.length > 0 && <PendingUnitsCard pending={pending} />}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle>Transactions</CardTitle>
            <CardDescription>{txs.length} recorded — full history</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href="/export.csv" download />}
            >
              <Download className="size-3.5" />
              Export CSV
            </Button>
            <AddTxDialog instruments={instruments} />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Instrument</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="hidden sm:table-cell">Note</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageTxs.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">{tx.date}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{tx.asset_type}</Badge>
                  </TableCell>
                  <TableCell>{tx.instrument}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono tabular-nums",
                      tx.amount < 0 && "text-(--chart-negative)",
                    )}
                  >
                    {fmtVND(tx.amount)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {tx.quantity ?? "—"}
                  </TableCell>
                  <TableCell className="hidden max-w-48 truncate text-muted-foreground sm:table-cell">
                    {tx.note}
                  </TableCell>
                  <TableCell>
                    <TxRowActions tx={tx} instruments={instruments} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t pt-4 text-sm text-muted-foreground">
              <span className="tabular-nums">
                {start + 1}–{start + pageTxs.length} of {txs.length}
              </span>
              <div className="flex items-center gap-3">
                {page > 1 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link href={`/transactions?page=${page - 1}`} />}
                  >
                    <ChevronLeft className="size-3.5" />
                    Previous
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    <ChevronLeft className="size-3.5" />
                    Previous
                  </Button>
                )}
                <span className="tabular-nums">Page {page} of {totalPages}</span>
                {page < totalPages ? (
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link href={`/transactions?page=${page + 1}`} />}
                  >
                    Next
                    <ChevronRight className="size-3.5" />
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    Next
                    <ChevronRight className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
