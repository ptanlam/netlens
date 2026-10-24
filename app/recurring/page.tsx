import { connection } from "next/server";
import * as db from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { SummaryCards } from "@/components/stat-card";
import { fmtVND } from "@/lib/format";
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

  const active = views.filter((v) => v.rule.active);
  const perMonth = active.reduce((a, v) => a + db.ruleMonthly(v.rule), 0);
  // Every rule due on the soonest date, since two rules often share a weekday.
  const next = active.map((v) => v.nextDue).filter((d) => d != null).sort()[0] ?? null;
  const dueNext = active.filter((v) => v.nextDue === next);
  const daysToNext = next && Math.round((Date.parse(next) - Date.parse(db.todayIso())) / 86_400_000);
  const funded = new Set(active.map((v) => v.rule.instrument)).size;

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PageHeader title="Recurring" actions={<AddRecurringDialog instruments={options} />}>
        Fixed amounts invested into a holding on a schedule. Due purchases are created
        automatically, and missed dates are backfilled.
      </PageHeader>
      <SummaryCards
        stats={[
          {
            label: "Active rules",
            value: String(active.length),
            unmask: true,
            sub: views.length > active.length ? `${views.length - active.length} paused` : "None paused",
          },
          {
            label: "Monthly equivalent",
            value: fmtVND(Math.round(perMonth)),
            sub: `≈ ${fmtVND(Math.round(perMonth * 12))} a year`,
            subAmount: true,
          },
          {
            label: "Next run",
            value: next ?? "—",
            unmask: true,
            sub: next
              ? `${daysToNext === 0 ? "Today" : daysToNext === 1 ? "Tomorrow" : `In ${daysToNext} days`} · ${dueNext.map((v) => v.rule.instrument).join(", ")}`
              : "Nothing scheduled",
          },
          {
            label: "Holdings funded",
            value: String(funded),
            unmask: true,
            sub: `of ${options.length} active holding${options.length === 1 ? "" : "s"}`,
          },
        ]}
      />
      <div className="card-surface panel-body">
        <RecurringManager rules={views} instruments={options} showAddForm={false} />
      </div>
    </div>
  );
}
