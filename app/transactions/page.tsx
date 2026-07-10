import { connection } from "next/server";
import { Download } from "lucide-react";
import * as db from "@/lib/db";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { TransactionsTable } from "@/components/transactions-table";
import { AddTxDialog } from "@/components/add-tx-dialog";
import { PendingUnitsCard } from "@/components/pending-units";

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
          <TransactionsTable transactions={txs} instruments={instruments} />
        </CardContent>
      </Card>
    </div>
  );
}
