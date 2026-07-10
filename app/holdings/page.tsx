import { connection } from "next/server";
import * as db from "@/lib/db";
import {
  Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { HoldingsForm } from "@/components/holdings-form";
import { AddHoldingDialog } from "@/components/add-holding-dialog";

export default async function HoldingsPage() {
  await connection();
  const instruments = db.listInstruments();
  const rows = instruments.map((inst) => ({ inst, value: db.holdingValue(inst) }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Holdings</CardTitle>
        <CardDescription>
          A holding is worth quantity × live price when both are set, otherwise its
          manual value. Symbols: CoinGecko id, Yahoo ticker, or fmarket short name.
        </CardDescription>
        <CardAction>
          <AddHoldingDialog />
        </CardAction>
      </CardHeader>
      <CardContent>
        <HoldingsForm rows={rows} />
      </CardContent>
    </Card>
  );
}
