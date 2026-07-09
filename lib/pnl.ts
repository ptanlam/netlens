/**
 * Reconstruct a daily P&L series from transactions + cached price history.
 * Ported from the Flask version's pnl.py — units held at time t are estimated
 * per transaction (recorded quantity, else amount / price(tx date)), anchored
 * to current holdings so the last point matches the live P&L card.
 */
import { getDb, listInstruments, priceHistoryByInstrument, todayIso } from "./db";
import type { PnlPoint } from "./types";

export type { PnlPoint } from "./types";

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

export function buildDailySeries(): PnlPoint[] {
  const db = getDb();
  const txs = db
    .prepare("SELECT date, instrument, amount, quantity FROM transactions ORDER BY date, id")
    .all() as { date: string; instrument: string; amount: number; quantity: number | null }[];
  if (!txs.length) return [];

  const history = priceHistoryByInstrument();

  interface Tracked {
    priceAt: (d: string) => number;
    events: [string, number][];
    offset: number;
    first: string;
  }
  const tracked: Record<string, Tracked> = {};
  const manual: { value: number; first: string }[] = [];

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
      tracked[inst.name] = { priceAt, events, offset: qtyNow - totalUnits, first };
    } else {
      manual.push({ value: inst.manual_value ?? 0, first });
    }
  }

  const series: PnlPoint[] = [];
  const end = todayIso();
  let txI = 0, invested = 0;
  const cursors: Record<string, number> = {};
  const cumUnits: Record<string, number> = {};
  for (const name of Object.keys(tracked)) { cursors[name] = 0; cumUnits[name] = 0; }

  const [sy, sm, sd] = txs[0].date.split("-").map(Number);
  const day = new Date(sy, sm - 1, sd);
  for (;;) {
    const ds = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    if (ds > end) break;

    while (txI < txs.length && txs[txI].date <= ds) { invested += txs[txI].amount; txI += 1; }

    let value = 0;
    for (const [name, tr] of Object.entries(tracked)) {
      while (cursors[name] < tr.events.length && tr.events[cursors[name]][0] <= ds) {
        cumUnits[name] += tr.events[cursors[name]][1];
        cursors[name] += 1;
      }
      if (ds >= tr.first) {
        const units = Math.max(tr.offset + cumUnits[name], 0);
        if (units) value += units * tr.priceAt(ds);
      }
    }
    for (const m of manual) if (ds >= m.first) value += m.value;

    series.push({ date: ds, invested, value: Math.round(value), pnl: Math.round(value) - invested });
    day.setDate(day.getDate() + 1);
  }
  return series;
}
