import { connection } from "next/server";
import * as db from "@/lib/db";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { RecurringManager } from "@/components/recurring-manager";

export default async function RecurringPage() {
  await connection();
  db.materializeRecurring();
  const rules = db.listRecurring().map((rule) => ({
    rule,
    nextDue: rule.active ? db.ruleNextDue(rule) : null,
  }));
  const instruments = db.listInstruments().map((i) => ({ name: i.name, asset_type: i.asset_type }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Recurring investments</CardTitle>
          <CardDescription>
            Auto-DCA rules — due purchases are created whenever the app loads, and missed
            dates are backfilled with the correct date. The schedule anchors on the start
            date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RecurringManager rules={rules} instruments={instruments} />
        </CardContent>
      </Card>
    </div>
  );
}
