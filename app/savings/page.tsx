import { connection } from "next/server";
import * as db from "@/lib/db";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { SavingsManager } from "@/components/savings-manager";

export default async function SavingsPage() {
  await connection();
  const savings = db.listSavings();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Savings</CardTitle>
          <CardDescription>
            Track term deposits — enter each deposit&apos;s principal, annual interest
            rate, and term. Estimated current value accrues to the maturity date
            (simple interest is paid at maturity; compound accrues monthly).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SavingsManager savings={savings} />
        </CardContent>
      </Card>
    </div>
  );
}
