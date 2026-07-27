import { connection } from "next/server";
import * as db from "@/lib/db";
import { DashboardCharts } from "@/components/dashboard-charts";
import { summarize, debtOwed, type Payment } from "@/lib/savings";
import { project, type GoalView } from "@/lib/goals";

export default async function Dashboard() {
  await connection();
  // Must land before anything reads transactions — it inserts the due ones.
  await db.materializeRecurring();

  // Everything below is independent, so it goes out as one fan-out rather than eight
  // sequential round trips. On better-sqlite3 that ordering was free; on D1 each call is
  // a network hop, and in series they were the slowest thing on the page.
  const [payload, pending, savings, debtPayments, debts, fundsCash, goalRows] =
    await Promise.all([
      db.buildPayload(),
      db.pendingFundUnits(),
      db.listSavings(),
      db.listDebtPayments(),
      db.listDebts(),
      db.fundsCashTotal(),
      db.listGoals(),
    ]);

  const savingsValue = summarize(savings).currentValue;
  const paymentsByDebt = new Map<number, Payment[]>();
  for (const p of debtPayments) {
    const list = paymentsByDebt.get(p.debt_id) ?? [];
    list.push(p);
    paymentsByDebt.set(p.debt_id, list);
  }
  const debtsValue = debts.reduce(
    (a, d) => a + debtOwed(d, paymentsByDebt.get(d.id) ?? []),
    0,
  );

  // Needs the portfolio total, so it can't join the fan-out above.
  const world = await db.buildGoalWorld(payload.portfolioTotal);
  const goals: GoalView[] = goalRows.map((goal) => ({ goal, proj: project(goal, world) }));

  return (
    <DashboardCharts
      payload={payload}
      savings={savingsValue}
      funds={fundsCash}
      debts={debtsValue}
      pending={pending.length}
      goals={goals}
    />
  );
}
