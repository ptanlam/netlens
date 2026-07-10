import { connection } from "next/server";
import * as db from "@/lib/db";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { DebtsManager } from "@/components/debts-manager";

export default async function DebtsPage() {
  await connection();
  const debts = db.listDebts();
  const payments = db.listDebtPayments();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Debts</CardTitle>
          <CardDescription>
            Track loans and credit accounts. Choose a <em>type</em>: <em>Fixed</em>
            {" "}(interest on the original amount), <em>Flexible</em> (interest recomputed
            on the remaining balance, so paying early saves interest), or <em>Credit</em>
            {" "}(a card/line with a required monthly payment — the app flags any credit
            account you haven&apos;t paid this month). Record repayments with the wallet button.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DebtsManager debts={debts} payments={payments} />
        </CardContent>
      </Card>
    </div>
  );
}
