import { connection } from "next/server";
import * as db from "@/lib/db";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { RefreshPricesButton } from "@/components/refresh-prices";
import { HoldingsForm } from "@/components/holdings-form";

export default async function HoldingsPage() {
  await connection();
  const instruments = db.listInstruments();
  const rows = instruments.map((inst) => ({ inst, value: db.holdingValue(inst) }));

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="space-y-1.5">
          <CardTitle>Holdings</CardTitle>
          <CardDescription>
            A holding is worth quantity × live price when both are set, otherwise its
            manual value. Symbols: CoinGecko id, Yahoo ticker, or fmarket short name.
          </CardDescription>
        </div>
        <RefreshPricesButton />
      </CardHeader>
      <CardContent>
        <HoldingsForm rows={rows} />
      </CardContent>
    </Card>
  );
}
