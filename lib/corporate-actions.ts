/**
 * Dividends and splits a stock holding went through that its transactions don't show.
 *
 * The evidence is Yahoo's event list (`fetchYahooEvents` in lib/prices.ts, kept in `meta`
 * by `refreshCorporateEvents` once a day). It is matched against your transactions here,
 * and what's left is suggested on /transactions, to be recorded or dismissed. Nothing is
 * ever recorded by itself: Yahoo can't see a rights issue you didn't take up, odd-lot
 * rounding or your broker's tax treatment, so you confirm each one.
 *
 * Pure, with no runtime imports, so `scripts/check-corporate-actions.mjs` runs it under
 * plain Node.
 */

export interface CorpEvents {
  /** Ex-dates. `amount` is ₫ per share **as Yahoo adjusts it for every later split**. */
  dividends: { date: string; amount: number }[];
  /** Ex-dates. A stock dividend is a split here too: 15% in shares is 115:100. */
  splits: { date: string; numerator: number; denominator: number }[];
}

export interface MissedAction {
  /** `instrument:kind:date`, also what a dismissal stores. */
  key: string;
  instrument: string;
  asset_type: string;
  kind: "dividend" | "bonus";
  /** The ex-date, which is the day the price drops, so the day to record it on. */
  date: string;
  /** Units held going into the ex-date. */
  held: number;
  /** Dividend: the ₫ received, after tax. Bonus: the units received. */
  value: number;
  /** One line on where `value` came from, for the panel and the transaction's note. */
  basis: string;
}

/** Personal income tax withheld from a cash dividend in Vietnam. */
export const DIVIDEND_TAX = 0.05;

/** How far a recorded dividend or bonus may sit from the ex-date and still count as this
 *  event's: you might have dated it the day the cash or the shares arrived instead. */
const MATCH_DAYS = 60;

type TxLike = { instrument: string; date: string; amount: number; quantity: number | null };
type InstrumentLike = { name: string; asset_type: string; quantity: number | null };

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
const vnd = (v: number) => Math.round(v).toLocaleString("de-DE");

export function missedActions(
  instruments: InstrumentLike[], txs: TxLike[], events: Record<string, CorpEvents>,
  dismissed: Set<string>, today: string,
): MissedAction[] {
  const out: MissedAction[] = [];
  for (const inst of instruments) {
    const ev = events[inst.name];
    const own = txs.filter((t) => t.instrument === inst.name);
    if (!ev || !own.length) continue;
    const first = own.reduce((m, t) => (t.date < m ? t.date : m), own[0].date);
    const total = own.reduce((a, t) => a + (t.quantity ?? 0), 0);
    const now = inst.quantity ?? total;
    // The shapes `txKind` (lib/types.ts) reads, inlined to keep this module import-free.
    const recorded = (kind: MissedAction["kind"], date: string) =>
      own.some((t) =>
        (kind === "bonus" ? t.amount === 0 && (t.quantity ?? 0) > 0 : t.amount < 0 && t.quantity === 0) &&
        days(t.date, date) <= MATCH_DAYS);

    // Chronological, carrying the bonus units suggested so far: a later event is owed on
    // the shares an earlier missed one would have added, recorded yet or not.
    const timeline = [
      ...ev.splits.map((s) => ({ kind: "bonus" as const, date: s.date, s, d: undefined })),
      ...ev.dividends.map((d) => ({ kind: "dividend" as const, date: d.date, s: undefined, d })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === "dividend" ? -1 : 1));
    let extra = 0;
    for (const e of timeline) {
      // Before your first transaction it isn't in the record; in the future it hasn't happened.
      if (e.date <= first || e.date > today) continue;
      // Same anchoring as `buildDaily`: today's units, less what arrived from the ex-date on.
      const held = now - own.filter((t) => t.date >= e.date).reduce((a, t) => a + (t.quantity ?? 0), 0) + extra;
      if (held <= 0) continue;
      const key = `${inst.name}:${e.kind}:${e.date}`;
      if (e.s) {
        // Fractions of a share are paid out in cash in Vietnam, so the units round down.
        const units = Math.floor((held * (e.s.numerator - e.s.denominator)) / e.s.denominator + 1e-9);
        if (units <= 0 || recorded("bonus", e.date)) continue;
        if (!dismissed.has(key)) extra += units;
        else continue;
        out.push({
          key, instrument: inst.name, asset_type: inst.asset_type, kind: "bonus", date: e.date, held,
          value: units, basis: `${e.s.numerator}:${e.s.denominator} on ${held.toLocaleString("de-DE")} held`,
        });
      } else if (e.d) {
        if (recorded("dividend", e.date) || dismissed.has(key)) continue;
        // Undo Yahoo's adjustment: every split since the ex-date shrank the per-share figure.
        // One announced for later hasn't been applied yet.
        const perShare = ev.splits
          .filter((s) => s.date > e.date && s.date <= today)
          .reduce((a, s) => (a * s.numerator) / s.denominator, e.d.amount);
        out.push({
          key, instrument: inst.name, asset_type: inst.asset_type, kind: "dividend", date: e.date, held,
          value: Math.round(held * perShare * (1 - DIVIDEND_TAX)),
          basis: `₫${vnd(perShare)}/share × ${held.toLocaleString("de-DE")}, less ${DIVIDEND_TAX * 100}% tax`,
        });
      }
    }
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}
