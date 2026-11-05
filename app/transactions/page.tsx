import { connection } from "next/server";
import * as db from "@/lib/db";
import { PendingUnitsCard, type PendingRow } from "@/components/pending-units";
import { CorporateActionsCard } from "@/components/corporate-actions";
import { TransactionsView } from "@/components/transactions-view";
import type { InstrumentOption } from "@/components/tx-form";
import { instrumentLogo } from "@/lib/logos";
import { missedActions } from "@/lib/corporate-actions";
import { METALS } from "@/lib/types";

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

  const [{ holding }, instruments, txs, pendingTxs, missingTxs, corp] = await Promise.all([
    searchParams,
    db.listInstruments(),
    db.allTransactions(),
    db.pendingFundUnits(),
    db.missingUnitsTxs(),
    db.corporateState(),
  ]);
  // `db.missedCorporateActions` would read the holdings and transactions again.
  const missed = missedActions(instruments, txs, corp.events, corp.dismissed, db.todayIso());

  // The add/edit dialogs offer live holdings only — you can still *see* an archived
  // holding's transactions, and edit them from the table, but a new buy against something
  // you've filed away is almost always a mistake.
  const options: InstrumentOption[] = instruments
    .filter((i) => i.archived !== 1)
    .map((i) => ({ name: i.name, asset_type: i.asset_type }));

  const logos: Record<string, string> = {};
  for (const i of instruments) {
    const logo = instrumentLogo(i);
    if (logo) logos[i.name] = logo;
  }

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
  const pending: PendingRow[] = pendingTxs.map((tx) => {
    const inst = instrumentByName.get(tx.instrument);
    return {
      tx,
      window: db.expectedUnitsWindow(tx.date),
      estUnits: inst?.last_price ? Number((tx.amount / inst.last_price).toFixed(2)) : null,
      hasHoldingQty: inst?.quantity != null,
      addByDefault: inst?.quantity != null,
    };
  });

  // Any buy or sell of a priced, non-fund holding saved without units (a stock or coin
  // typed as an amount only). Same panel, same Save.
  // Whether its units are already in the holding's quantity can't be known for sure: they
  // are not if that quantity is exactly the sum of the units the transactions do carry,
  // which is what "only a transaction moves it" leaves behind. Otherwise it was set by
  // hand at some point, likely with these units in it, so adding them is left unticked.
  const knownUnits = new Map<string, number>();
  for (const t of txs)
    if (t.quantity != null) knownUnits.set(t.instrument, (knownUnits.get(t.instrument) ?? 0) + t.quantity);
  const missing: PendingRow[] = missingTxs.map((tx) => {
    const inst = instrumentByName.get(tx.instrument);
    // The close it's being priced at now, so "est." is what the app already assumes. Not
    // for a metal: that close is the buy-back price, which would invent metal.
    const est = tx.asset_type !== METALS && tx.px_at ? Math.abs(tx.amount) / tx.px_at : null;
    return {
      tx,
      window: null,
      estUnits: est == null ? null : Number(est.toPrecision(6)),
      hasHoldingQty: inst?.quantity != null,
      addByDefault:
        inst?.quantity != null && Math.abs(inst.quantity - (knownUnits.get(tx.instrument) ?? 0)) < 1e-6,
    };
  });

  return (
    <TransactionsView
      txs={txs}
      options={options}
      logos={logos}
      initialHolding={initialHolding}
      banner={pending.length > 0 || missing.length > 0 || missed.length > 0 ? (
        <div className="flex flex-col gap-3">
          {(pending.length > 0 || missing.length > 0) && <PendingUnitsCard pending={pending} missing={missing} />}
          {missed.length > 0 && <CorporateActionsCard actions={missed} />}
        </div>
      ) : null}
    />
  );
}
