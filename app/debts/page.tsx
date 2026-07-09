import { connection } from "next/server";
import * as db from "@/lib/db";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { DebtsManager } from "@/components/debts-manager";

export default async function DebtsPage() {
  await connection();
  const debts = db.listDebts();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Debts</CardTitle>
          <CardDescription>
            Track loans and credit-card balances with interest. For a fixed-term loan,
            enter the term; for a credit card, tick <em>Revolving</em> to leave it
            open-ended. The estimated amount owed accrues interest (a gross estimate that
            doesn&apos;t account for repayments).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DebtsManager debts={debts} />
        </CardContent>
      </Card>
    </div>
  );
}
