import { connection } from "next/server";
import * as db from "@/lib/db";
import { InvestmentManager, type HoldingView } from "@/components/investment-manager";

export default async function InvestmentsPage() {
  await connection();
  // Must land before anything reads transactions — it inserts the due ones.
  await db.materializeRecurring();

  const [instruments, txs, sources, historyStamp, predictions, goals] = await Promise.all([
    db.listInstruments(),
    db.allTransactions(),
    db.listPriceSources(),
    db.historyStamp(),
    db.realEstatePredictions(),
    db.listGoals(true),
  ]);
  // Sinking funds a holding can be earmarked for: the active ones, plus any archived fund a
  // holding still points at, so its row can name it and its form doesn't silently drop it.
  const funds = goals
    .filter((g) => g.metric === "fund" && (g.archived === 0 || instruments.some((i) => i.goal_id === g.id)))
    .map((g) => ({ id: g.id, name: g.name }));
  const sourceKeys = [db.MANUAL_SOURCE, ...sources.map((s) => s.key)];

  // Cost basis per holding, and how many transactions built it. The rows themselves live on
  // /transactions now — a holding row only quotes the count and links through.
  const costBy: Record<string, number> = {};
  const txCountBy: Record<string, number> = {};
  for (const tx of txs) {
    // A fund buy awaiting units isn't in the holding's quantity yet, so it isn't cost either.
    if (!db.awaitingUnits(tx)) costBy[tx.instrument] = (costBy[tx.instrument] ?? 0) + tx.amount;
    txCountBy[tx.instrument] = (txCountBy[tx.instrument] ?? 0) + 1;
  }

  // The same figures the dashboard's payload carries, from rows this page already holds —
  // `livePayload` is pure, so the Allocation and Top holdings panels cost no extra query.
  const payload = db.livePayload(instruments, costBy);

  const holdings: HoldingView[] = instruments
    .map((inst) => {
      const value = db.holdingValue(inst);
      const cost = costBy[inst.name] ?? 0;
      return { inst, value, cost, pnl: value - cost, live: inst.quantity != null && inst.last_price != null };
    })
    .sort((a, b) => b.value - a.value || a.inst.name.localeCompare(b.inst.name));

  return (
    <InvestmentManager
      holdings={holdings}
      payload={payload}
      historyStamp={historyStamp}
      txCountBy={txCountBy}
      sourceKeys={sourceKeys}
      predictions={predictions}
      funds={funds}
    />
  );
}
