import { connection } from "next/server";
import * as db from "@/lib/db";
import { PendingUnitsCard } from "@/components/pending-units";
import { TransactionsView } from "@/components/transactions-view";
import type { InstrumentOption } from "@/components/tx-form";

export default async function TransactionsPage({
  searchParams,
}: {
  // A Promise in Next 16 — see docs/CONVENTIONS.md.
  searchParams: Promise<{ holding?: string }>;
}) {
  await connection();
  // Must land before anything reads transactions — it inserts the due ones. Same call the
  // Investments page makes; whichever page you open first is the one that materialises them.
  await db.materializeRecurring();

  const [{ holding }, instruments, txs, pendingTxs] = await Promise.all([
    searchParams,
    db.listInstruments(),
    db.allTransactions(),
    db.pendingFundUnits(),
  ]);

  // The add/edit dialogs offer live holdings only — you can still *see* an archived
  // holding's transactions, and edit them from the table, but a new buy against something
  // you've filed away is almost always a mistake.
  const options: InstrumentOption[] = instruments
    .filter((i) => i.archived !== 1)
    .map((i) => ({ name: i.name, asset_type: i.asset_type }));

  // A `?holding=` naming something that no longer exists (a renamed or deleted holding, a
  // hand-edited URL) falls back to everything rather than to an empty page with a filter
  // set to a name the picker can't even show.
  const known = new Set(txs.map((t) => t.instrument));
  const initialHolding = holding && known.has(holding) ? holding : "All";

  // Fund buys whose unit count hasn't landed yet (T+1/T+2). This is a transaction problem —
  // every row is a transaction, and confirming one writes `quantity` back to it — so the
  // panel sits here rather than on /investments, where it lived while this page didn't
  // exist. Looked up from the instrument list already in hand rather than a query per row,
  // which on D1 would be a round trip each.
  const instrumentByName = new Map(instruments.map((i) => [i.name, i]));
  const pending = pendingTxs.map((tx) => {
    const inst = instrumentByName.get(tx.instrument);
    return {
      tx,
      window: db.expectedUnitsWindow(tx.date),
      estUnits: inst?.last_price ? Number((tx.amount / inst.last_price).toFixed(2)) : null,
      hasHoldingQty: inst?.quantity != null,
    };
  });

  return (
    <TransactionsView
      txs={txs}
      options={options}
      initialHolding={initialHolding}
      banner={pending.length > 0 ? <PendingUnitsCard pending={pending} /> : null}
    />
  );
}
