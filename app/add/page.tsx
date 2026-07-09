import { connection } from "next/server";
import * as db from "@/lib/db";
import { addTx } from "@/app/actions";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { TxForm } from "@/components/tx-form";

export default async function AddPage() {
  await connection();
  const instruments = db.instrumentNames();
  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Add investment</CardTitle>
        <CardDescription>
          Record a buy or sell. Amounts are whole VND; quantity can be confirmed later
          for fund purchases.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TxForm action={addTx} instruments={instruments} />
      </CardContent>
    </Card>
  );
}
