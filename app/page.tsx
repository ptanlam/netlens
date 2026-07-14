import { connection } from "next/server";
import * as db from "@/lib/db";
import { DashboardCharts } from "@/components/dashboard-charts";
import { summarize, debtOwed, type Payment } from "@/lib/savings";
import { project, type GoalView } from "@/lib/goals";

export default async function Dashboard() {
  await connection();
  db.materializeRecurring();
  const payload = db.buildPayload();
  const pending = db.pendingFundUnits();

  const savingsValue = summarize(db.listSavings()).currentValue;
  const debtPayments = db.listDebtPayments();
  const paymentsByDebt = new Map<number, Payment[]>();
  for (const p of debtPayments) {
    const list = paymentsByDebt.get(p.debt_id) ?? [];
    list.push(p);
    paymentsByDebt.set(p.debt_id, list);
  }
  const debtsValue = db
    .listDebts()
    .reduce((a, d) => a + debtOwed(d, paymentsByDebt.get(d.id) ?? []), 0);

  const world = db.buildGoalWorld(payload.portfolioTotal);
  const goals: GoalView[] = db
    .listGoals()
    .map((goal) => ({ goal, proj: project(goal, world) }));

  return (
    <DashboardCharts
      payload={payload}
      savings={savingsValue}
      debts={debtsValue}
      pending={pending.length}
      goals={goals}
    />
  );
}
