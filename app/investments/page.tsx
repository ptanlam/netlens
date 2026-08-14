import { connection } from "next/server";
import * as db from "@/lib/db";
import type { RecurringRule } from "@/lib/types";
import { InvestmentManager, type HoldingView } from "@/components/investment-manager";

export default async function InvestmentsPage() {
  await connection();
  // Must land before anything reads transactions — it inserts the due ones.
  await db.materializeRecurring();

  const [instruments, txs, rules, sources] = await Promise.all([
    db.listInstruments(),
    db.allTransactions(),
    db.listRecurring(),
    db.listPriceSources(),
  ]);
  const sourceKeys = [db.MANUAL_SOURCE, ...sources.map((s) => s.key)];

  // Cost basis per holding, and how many transactions built it. The rows themselves live on
  // /transactions now — a holding row only quotes the count and links through.
  const costBy: Record<string, number> = {};
  const txCountBy: Record<string, number> = {};
  for (const tx of txs) {
    costBy[tx.instrument] = (costBy[tx.instrument] ?? 0) + tx.amount;
    txCountBy[tx.instrument] = (txCountBy[tx.instrument] ?? 0) + 1;
  }

  const rulesByInstrument: Record<string, { rule: RecurringRule; nextDue: string | null }[]> = {};
  for (const rule of rules) {
    (rulesByInstrument[rule.instrument] ??= []).push({
      rule,
      nextDue: rule.active ? db.ruleNextDue(rule) : null,
    });
  }

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
      txCountBy={txCountBy}
      rulesByInstrument={rulesByInstrument}
      sourceKeys={sourceKeys}
    />
  );
}
