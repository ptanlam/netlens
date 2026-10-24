import { connection } from "next/server";
import * as db from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { AddRecurringDialog } from "@/components/add-recurring-dialog";
import { RecurringManager } from "@/components/recurring-manager";
import type { InstrumentOption } from "@/components/tx-form";

export default async function RecurringPage() {
  await connection();
  const [rules, instruments] = await Promise.all([db.listRecurring(), db.listInstruments()]);
  // Same as /transactions: a new rule against an archived holding is almost always a mistake.
  const options: InstrumentOption[] = instruments
    .filter((i) => i.archived !== 1)
    .map((i) => ({ name: i.name, asset_type: i.asset_type }));
  const views = rules
    .map((rule) => ({ rule, nextDue: rule.active ? db.ruleNextDue(rule) : null }))
    .sort((a, b) => a.rule.instrument.localeCompare(b.rule.instrument));

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PageHeader title="Recurring" actions={<AddRecurringDialog instruments={options} />}>
        Fixed amounts invested into a holding on a schedule. Due purchases are created
        automatically, and missed dates are backfilled.
      </PageHeader>
      <div className="card-surface panel-body">
        <RecurringManager rules={views} instruments={options} showAddForm={false} />
      </div>
    </div>
  );
}
