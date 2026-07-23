import { connection } from "next/server";
import * as db from "@/lib/db";
import type { RecurringRule, Tx } from "@/lib/types";
import { InvestmentManager, type HoldingView } from "@/components/investment-manager";
import { PendingUnitsCard } from "@/components/pending-units";

export default async function InvestmentsPage() {
  await connection();
  db.materializeRecurring();

  const instruments = db.listInstruments();
  const txs = db.allTransactions();
  const rules = db.listRecurring();
  const sourceKeys = [db.MANUAL_SOURCE, ...db.listPriceSources().map((s) => s.key)];

  const costBy: Record<string, number> = {};
  const txsByInstrument: Record<string, Tx[]> = {};
  for (const tx of txs) {
    costBy[tx.instrument] = (costBy[tx.instrument] ?? 0) + tx.amount;
    (txsByInstrument[tx.instrument] ??= []).push(tx);
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

  const pending = db.pendingFundUnits().map((tx) => {
    const inst = db.getInstrument(tx.instrument);
    return {
      tx,
      window: db.expectedUnitsWindow(tx.date),
      estUnits: inst?.last_price ? Number((tx.amount / inst.last_price).toFixed(2)) : null,
      hasHoldingQty: inst?.quantity != null,
    };
  });

  return (
    <div className="flex flex-col gap-3 sm:gap-[18px]">
      {pending.length > 0 && <PendingUnitsCard pending={pending} />}
      <InvestmentManager
        holdings={holdings}
        allTxs={txs}
        txsByInstrument={txsByInstrument}
        rulesByInstrument={rulesByInstrument}
        sourceKeys={sourceKeys}
      />
    </div>
  );
}
