import { connection } from "next/server";
import * as db from "@/lib/db";
import { GoalsManager } from "@/components/goals-manager";
import { project, valueAt, type GoalView } from "@/lib/goals";
import type { GoalMetric } from "@/lib/types";

export default async function GoalsPage() {
  await connection();
  const payload = db.buildPayload();
  const world = db.buildGoalWorld(payload.portfolioTotal);
  const goals = db.listGoals(true);

  const views: GoalView[] = goals.map((goal) => ({ goal, proj: project(goal, world) }));

  // Today's value of every metric, so the form can prefill a debt goal's starting balance.
  const current = {
    net_worth: valueAt(world, "net_worth", 0, 0),
    investments: valueAt(world, "investments", 0, 0),
    savings: valueAt(world, "savings", 0, 0),
    debts: valueAt(world, "debts", 0, 0),
  } satisfies Record<GoalMetric, number>;

  return (
    <div>
      <div className="mb-3.5">
        <div className="font-serif text-[22px] font-semibold tracking-[-0.01em]">Goals</div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          A target on a figure you already track. Progress is read live from your data, and
          the projection uses money you&apos;ve committed — recurring rules and repayment
          schedules — with market growth counted as zero.
        </div>
      </div>
      <GoalsManager goals={views} current={current} />
    </div>
  );
}
