/**
 * Reconstruct a daily P&L series from transactions + cached price history.
 * Ported from the Flask version's pnl.py — units held at time t are estimated
 * per transaction (recorded quantity, else amount / price(tx date)), anchored
 * to current holdings so the last point matches the live P&L card.
 *
 * Past days are priced from the stored daily close; today is priced from each
 * instrument's live `last_price`, so today's move (and its per-holding breakdown)
 * tracks every price refresh rather than only the sources that stamp a daily bar.
 */
import { getDb, listInstruments, priceHistoryByInstrument, todayIso } from "./db";
import type { HoldingPnlPoint, PnlPoint } from "./types";

export type { HoldingPnlPoint, PnlPoint } from "./types";

function priceLookup(points: [string, number][]) {
  const dates = points.map((p) => p[0]);
  return (dateIso: string): number => {
    // last point with date <= dateIso (binary search), else first available
    let lo = 0, hi = dates.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= dateIso) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return points[ans >= 0 ? ans : 0][1];
  };
}

/**
 * Core daily reconstruction. Produces both the aggregate P&L series and a
 * per-holding breakdown of each day's move; the breakdown for a day sums (up to
 * rounding) to that day's aggregate P&L delta.
 */
export function buildDaily(): { series: PnlPoint[]; holdings: HoldingPnlPoint[] } {
  const db = getDb();
  const txs = db
    .prepare("SELECT date, instrument, amount, quantity FROM transactions ORDER BY date, id")
    .all() as { date: string; instrument: string; amount: number; quantity: number | null }[];
  if (!txs.length) return { series: [], holdings: [] };

  const history = priceHistoryByInstrument();

  interface Tracked {
    type: string;
    priceAt: (d: string) => number;
    /** Live price from the last refresh. Only `price_history` knows past days, but for
     *  *today* this is the truest price we have — and the only one that moves when the
     *  user hits refresh, since a quote on a closed market is never stamped into the
     *  daily history (see CONTINUOUS_STRATEGIES in lib/prices.ts). Using it here is also
     *  what makes the series' last point agree with the live P&L card. */
    livePrice: number | null;
    events: [string, number][];
    offset: number;
    first: string;
  }
  const tracked: Record<string, Tracked> = {};
  const manual: { name: string; type: string; value: number; first: string }[] = [];

  for (const inst of listInstruments()) {
    const instTxs = txs.filter((t) => t.instrument === inst.name);
    if (!instTxs.length) continue;
    const first = instTxs[0].date;
    const points = history[inst.name];
    if (points?.length) {
      const priceAt = priceLookup(points);
      const events: [string, number][] = [];
      let totalUnits = 0;
      for (const t of instTxs) {
        const units = t.quantity != null ? t.quantity : t.amount / priceAt(t.date);
        events.push([t.date, units]);
        totalUnits += units;
      }
      const qtyNow = inst.quantity != null ? inst.quantity : totalUnits;
      tracked[inst.name] = {
        type: inst.asset_type,
        priceAt,
        livePrice: inst.last_price,
        events,
        offset: qtyNow - totalUnits,
        first,
      };
    } else {
      manual.push({ name: inst.name, type: inst.asset_type, value: inst.manual_value ?? 0, first });
    }
  }

  const series: PnlPoint[] = [];
  const holdings: HoldingPnlPoint[] = [];
  const end = todayIso();
  let txI = 0, invested = 0;
  const cursors: Record<string, number> = {};
  const cumUnits: Record<string, number> = {};
  const prevValue: Record<string, number> = {}; // rounded per-holding value, previous day
  for (const name of Object.keys(tracked)) { cursors[name] = 0; cumUnits[name] = 0; prevValue[name] = 0; }
  for (const m of manual) prevValue[m.name] = 0;

  const [sy, sm, sd] = txs[0].date.split("-").map(Number);
  const day = new Date(sy, sm - 1, sd);
  for (;;) {
    const ds = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    if (ds > end) break;

    // Contributions landing exactly on this day, per instrument (txs are
    // consumed on the first day ds >= tx.date, i.e. on ds === tx.date).
    const contribToday: Record<string, number> = {};
    while (txI < txs.length && txs[txI].date <= ds) {
      invested += txs[txI].amount;
      contribToday[txs[txI].instrument] = (contribToday[txs[txI].instrument] ?? 0) + txs[txI].amount;
      txI += 1;
    }

    let value = 0;
    const dayHoldings: HoldingPnlPoint["holdings"] = [];
    for (const [name, tr] of Object.entries(tracked)) {
      while (cursors[name] < tr.events.length && tr.events[cursors[name]][0] <= ds) {
        cumUnits[name] += tr.events[cursors[name]][1];
        cursors[name] += 1;
      }
      let raw = 0;
      if (ds >= tr.first) {
        const units = Math.max(tr.offset + cumUnits[name], 0);
        // Today is priced live; every earlier day is settled, so it uses the stored close.
        const price = ds === end && tr.livePrice != null ? tr.livePrice : tr.priceAt(ds);
        if (units) raw = units * price;
      }
      value += raw;
      const v = Math.round(raw);
      const pnl = v - prevValue[name] - (contribToday[name] ?? 0);
      if (v !== 0 || pnl !== 0)
        dayHoldings.push({ name, type: tr.type, value: v, pnl });
      prevValue[name] = v;
    }
    for (const m of manual) {
      const v = ds >= m.first ? m.value : 0;
      value += v;
      const pnl = v - prevValue[m.name] - (contribToday[m.name] ?? 0);
      if (v !== 0 || pnl !== 0)
        dayHoldings.push({ name: m.name, type: m.type, value: v, pnl });
      prevValue[m.name] = v;
    }

    series.push({ date: ds, invested, value: Math.round(value), pnl: Math.round(value) - invested });
    holdings.push({ date: ds, holdings: dayHoldings });
    day.setDate(day.getDate() + 1);
  }
  return { series, holdings };
}

export function buildDailySeries(): PnlPoint[] {
  return buildDaily().series;
}
