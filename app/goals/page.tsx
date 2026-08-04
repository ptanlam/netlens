import { connection } from "next/server";
import * as db from "@/lib/db";
import { GoalsManager } from "@/components/goals-manager";
import { project, valueAt, type GoalView } from "@/lib/goals";
import type { GoalContribution, GoalMetric } from "@/lib/types";

export default async function GoalsPage() {
  await connection();
  const [payload, goals, allContributions, deposits] = await Promise.all([
    db.buildPayload(),
    db.listGoals(true),
    // The whole ledger in one read, then grouped below — the per-goal loop this replaces
    // was a query per fund.
    db.listGoalContributions(),
    db.savingsByGoal(),
  ]);
  const world = await db.buildGoalWorld(payload.portfolioTotal);

  const views: GoalView[] = goals.map((goal) => ({ goal, proj: project(goal, world) }));

  // Each fund's cash ledger and its earmarked deposits, so the card can show where the
  // balance came from. Funds get an entry even when empty, so the card can tell "no
  // contributions yet" from "not a fund".
  const contributions: Record<number, GoalContribution[]> = {};
  for (const g of goals) if (g.metric === "fund") contributions[g.id] = [];
  for (const c of allContributions) contributions[c.goal_id]?.push(c);

  // Today's value of every metric, so the form can prefill a debt goal's starting balance.
  // `fund` has no world-level figure — each one is its own pot — so it reads as zero.
  const current = {
    net_worth: valueAt(world, { metric: "net_worth" }, 0, 0),
    investments: valueAt(world, { metric: "investments" }, 0, 0),
    savings: valueAt(world, { metric: "savings" }, 0, 0),
    debts: valueAt(world, { metric: "debts" }, 0, 0),
    fund: 0,
  } satisfies Record<GoalMetric, number>;

  // The heading lives in <GoalsManager>: the design seats a page's primary action beside
  // its title, and "New goal" is a client dialog, so the two have to share a component.
  return (
    <GoalsManager goals={views} current={current} contributions={contributions} deposits={deposits} />
  );
}
