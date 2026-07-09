import { connection } from "next/server";
import { Download } from "lucide-react";
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
import { PendingUnitsCard } from "@/components/pending-units";
import { cn } from "@/lib/utils";

export default async function TransactionsPage() {
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

  return (
    <div className="flex flex-col gap-6">
      {pending.length > 0 && <PendingUnitsCard pending={pending} />}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle>Transactions</CardTitle>
            <CardDescription>{txs.length} recorded — full history</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            render={<a href="/export.csv" download />}
          >
            <Download className="size-3.5" />
            Export CSV
          </Button>
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
              {txs.map((tx) => (
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
        </CardContent>
      </Card>
    </div>
  );
}
