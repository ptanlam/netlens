import { connection } from "next/server";
import * as db from "@/lib/db";
import { DashboardCharts } from "@/components/dashboard-charts";
import { summarize, debtOwed, type Payment } from "@/lib/savings";
import { commitment, streak } from "@/lib/score";
import type { InstrumentOption } from "@/components/tx-form";
import type { DashboardAlert } from "@/components/dashboard-charts";

const HOUR = 3600 * 1000;

/** The unattended jobs, as alerts: one that failed, stopped, or wants a look. Silent for a
 *  job that has never reported, since that is one not set up yet (or, for the backup, the
 *  day before its first night). */
function jobAlerts(jobs: Awaited<ReturnType<typeof db.jobStatuses>>, now: number): DashboardAlert[] {
  const out: DashboardAlert[] = [];
  const since = (iso?: string | null) => (iso ? now - new Date(iso).getTime() : Infinity);
  const { backup, gmail } = jobs;
  if (backup?.error && since(backup.error_at) < since(backup.ok_at))
    out.push({ title: "Last night's backup failed", detail: `${backup.error}. See the Worker logs.` });
  // Nightly, so a day and a half is one missed night with room for a late start.
  else if (backup?.ok_at && since(backup.ok_at) > 36 * HOUR)
    out.push({ title: "No backup for over a day", detail: `The last one was ${backup.ok_at.slice(0, 10)}. Check the Worker's Cron Triggers.` });
  if (gmail?.ok_at && since(gmail.ok_at) > 3 * HOUR)
    out.push({
      title: "The Gmail script has stopped running",
      detail: `Last run ${gmail.ok_at.slice(0, 16).replace("T", " ")} UTC. Check its trigger at script.google.com.`,
    });
  else if (gmail?.detail)
    out.push({ title: `The Gmail script found ${gmail.detail}`, detail: "Run dryRun at script.google.com to see their text." });
  return out;
}

export default async function Dashboard() {
  await connection();
  // Must land before anything reads transactions — it inserts the due ones.
  await db.materializeRecurring();

  // Everything below is independent, so it goes out as one fan-out rather than eight
  // sequential round trips. On better-sqlite3 that ordering was free; on D1 each call is
  // a network hop, and in series they were the slowest thing on the page.
  const [payload, pending, savings, debtPayments, debts, fundsCash, goalRows, invested, historyStamp, instruments, predictions] =
    await Promise.all([
      db.buildPayload(),
      db.pendingFundUnits(),
      db.listSavings(true),
      db.listDebtPayments(),
      db.listDebts(),
      db.fundsCashTotal(),
      db.listGoals(),
      db.investedByMonth(),
      db.historyStamp(),
      db.listInstruments(),
      db.realEstatePredictions(),
    ]);
  // Not in the fan-out above only because its type list is already eleven long.
  const [missed, jobs] = await Promise.all([db.missedCorporateActions(), db.jobStatuses()]);

  // Live holdings only, as on /transactions: a new buy against an archived holding is
  // almost always a mistake.
  const options: InstrumentOption[] = instruments
    .filter((i) => i.archived !== 1)
    .map((i) => ({ name: i.name, asset_type: i.asset_type }));

  // Withdrawn deposits are out of net worth but stay in the streak: that money did move.
  const savingsValue = summarize(savings.filter((s) => !s.archived_date)).currentValue;
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

  // Price-independent by construction — the streak counts money you moved, never what the
  // market did — so it's computed once here and shipped as a finished view. A price tick
  // can't change it, which is why it doesn't go through the client's re-projection below.
  const streakView = streak({
    today: world.today,
    investedByMonth: invested,
    savings,
    ...commitment(world.plannedMonthly, goalRows),
  });

  const alerts: DashboardAlert[] = [];
  if (pending.length)
    alerts.push({
      href: "/transactions",
      title: `${pending.length} fund purchase${pending.length > 1 ? "s" : ""} awaiting unit confirmation`,
      detail: "Enter the confirmed units on the Transactions page so live valuation stays accurate.",
    });
  if (missed.length)
    alerts.push({
      href: "/transactions",
      title: `${missed.length} dividend${missed.length > 1 ? "s or splits" : " or split"} not recorded`,
      detail: "Yahoo lists them for your stocks, and your transactions don't. Review them on the Transactions page.",
    });
  // The world's clock, not `Date.now()` here: a render must not read the clock itself.
  alerts.push(...jobAlerts(jobs, world.nowMs));

  // `world` and `goalRows` go to the client rather than a finished `GoalView[]`: a price
  // tick moves `investments`, and everything else in the world (deposits, debts, fund
  // ledgers) is price-independent, so the client can re-project from the same inputs
  // instead of asking the server to rebuild all of it. `project` is pure and deterministic
  // given a world — it reads `nowMs` from it, never the clock — so SSR and hydration agree.
  return (
    <DashboardCharts
      payload={payload}
      savings={savingsValue}
      funds={fundsCash}
      debts={debtsValue}
      alerts={alerts}
      goalRows={goalRows}
      world={world}
      streak={streakView}
      historyStamp={historyStamp}
      instruments={options}
      predictions={predictions}
    />
  );
}
