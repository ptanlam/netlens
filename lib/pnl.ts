/**
 * Reconstruct a daily P&L series from transactions + cached price history.
 * Ported from the Flask version's pnl.py — units held at time t are estimated
 * per transaction (recorded quantity, else amount / price(tx date)), anchored
 * to current holdings so the last point matches the live P&L card.
 *
 * Past days are priced from the stored daily close. Today is priced from the live
 * `last_price` wherever that really is today's price (crypto, and stocks intraday), so
 * today's move tracks every price refresh. Funds are the exception: they report NAV a day
 * late, so today uses the stored close for them too (see NAV_STRATEGIES in lib/types.ts).
 */
import {
  listInstruments, listPriceSources, pnlTransactions, priceHistoryByInstrument, recentCloses,
  todayIso, txRollup, txUnitPrices,
} from "./db";
import type { HoldingDayPnl, HoldingPnlPoint, PnlPoint } from "./types";
import { NAV_STRATEGIES } from "./types";

export type { HoldingPnlPoint, PnlPoint } from "./types";

/** Price on a date, plus the date that price was actually stored under. They differ
 *  whenever a day is carried forward from an older close — which is every weekend, and
 *  every day a feed hasn't settled yet. `priceAt` alone can't tell those apart from a
 *  genuinely flat market, so `anchorAt` is what lets the caller measure the real span. */
function priceLookup(points: [string, number][]) {
  const dates = points.map((p) => p[0]);
  // last point with date <= dateIso (binary search), else first available
  const indexAt = (dateIso: string): number => {
    let lo = 0, hi = dates.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= dateIso) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return ans >= 0 ? ans : 0;
  };
  return {
    priceAt: (dateIso: string): number => points[indexAt(dateIso)][1],
    anchorAt: (dateIso: string): string => points[indexAt(dateIso)][0],
  };
}

/**
 * Core daily reconstruction. Produces both the aggregate P&L series and a
 * per-holding breakdown of each day's move; the breakdown for a day sums (up to
 * rounding) to that day's aggregate P&L delta.
 */
export async function buildDaily(): Promise<{ series: PnlPoint[]; holdings: HoldingPnlPoint[] }> {
  // All four reads are independent, and the price sources are pulled as one list rather
  // than looked up per instrument inside the loop below — on D1 that loop would have been
  // a query per holding.
  const [txs, history, instruments, sources] = await Promise.all([
    pnlTransactions(),
    priceHistoryByInstrument(),
    listInstruments(),
    listPriceSources(),
  ]);
  if (!txs.length) return { series: [], holdings: [] };

  const strategyBySource = new Map(sources.map((s) => [s.key, s.history_strategy]));

  interface Tracked {
    type: string;
    priceAt: (d: string) => number;
    /** Date the price returned by `priceAt(d)` was stored under — `d` itself on a settled
     *  day, an older close on a carried-forward one. */
    anchorAt: (d: string) => string;
    /** Live price from the last refresh — for *today* the truest price we have, and the
     *  only one that moves when the user hits refresh, since a stock quote mid-session is
     *  never stamped into the daily history (see CONTINUOUS_STRATEGIES in lib/prices.ts).
     *  Using it is also what keeps the series' last point level with the live P&L card.
     *  Null for funds: their last_price is the NAV of a past valuation day, not today's,
     *  so today falls back to the stored close (see NAV_STRATEGIES in lib/types.ts). */
    livePrice: number | null;
    events: [string, number][];
    offset: number;
    first: string;
    /** Last day this instrument has a real stored close. Any later day is carried
     *  forward (not yet settled) — drives each day's "complete/partial" status. */
    lastClose: string;
  }
  const tracked: Record<string, Tracked> = {};
  const manual: { name: string; type: string; value: number; first: string }[] = [];

  for (const inst of instruments) {
    const instTxs = txs.filter((t) => t.instrument === inst.name);
    if (!instTxs.length) continue;
    const first = instTxs[0].date;
    const points = history[inst.name];
    if (points?.length) {
      const { priceAt, anchorAt } = priceLookup(points);
      const events: [string, number][] = [];
      let totalUnits = 0;
      for (const t of instTxs) {
        const units = t.quantity != null ? t.quantity : t.amount / priceAt(t.date);
        events.push([t.date, units]);
        totalUnits += units;
      }
      const qtyNow = inst.quantity != null ? inst.quantity : totalUnits;
      const strat = strategyBySource.get(inst.price_source) ?? "none";
      tracked[inst.name] = {
        type: inst.asset_type,
        priceAt,
        anchorAt,
        livePrice: NAV_STRATEGIES.has(strat) ? null : inst.last_price,
        events,
        offset: qtyNow - totalUnits,
        first,
        lastClose: points[points.length - 1][0],
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
  let prevDs = ""; // the day before `ds`, i.e. what today's move is subtracted from
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
    let held = 0, settled = 0; // holdings contributing today, and how many are settled
    // Oldest close any of today's live-priced holdings is really being measured against.
    let baseline: string | undefined;
    const dayHoldings: HoldingPnlPoint["holdings"] = [];
    for (const [name, tr] of Object.entries(tracked)) {
      while (cursors[name] < tr.events.length && tr.events[cursors[name]][0] <= ds) {
        cumUnits[name] += tr.events[cursors[name]][1];
        cursors[name] += 1;
      }
      let raw = 0;
      if (ds >= tr.first) {
        const units = Math.max(tr.offset + cumUnits[name], 0);
        // Today is priced live where a live quote really means today (crypto, stocks);
        // every earlier day — and today for funds — uses the stored close.
        const livePrice = ds === end ? tr.livePrice : null;
        const live = livePrice != null;
        const price = livePrice ?? tr.priceAt(ds);
        if (units) {
          raw = units * price;
          held += 1;
          // Settled once the instrument has a real close on/through this day; later days
          // are carried forward from the last close and may still move.
          if (ds <= tr.lastClose) settled += 1;
          // Only a live-priced holding that actually moved can widen the span. Its previous
          // value came from whatever close yesterday resolved to — yesterday's own if the
          // feed has settled it, otherwise an older one, and then this day's move silently
          // covers everything since. A holding sitting at exactly the price it carried
          // yesterday contributed nothing, so it must not drag the label back: over a
          // weekend every stock is frozen at Friday's close while crypto keeps trading, and
          // counting them would report a two-day span for a move that is purely today's.
          if (live && prevDs && price !== tr.priceAt(prevDs)) {
            const anchor = tr.anchorAt(prevDs);
            if (baseline === undefined || anchor < baseline) baseline = anchor;
          }
        }
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
      if (v !== 0) { held += 1; settled += 1; } // static value is always settled
      value += v;
      const pnl = v - prevValue[m.name] - (contribToday[m.name] ?? 0);
      if (v !== 0 || pnl !== 0)
        dayHoldings.push({ name: m.name, type: m.type, value: v, pnl });
      prevValue[m.name] = v;
    }

    const status = ds === end ? "live" : settled === held ? "complete" : "partial";
    series.push({
      date: ds, invested, value: Math.round(value), pnl: Math.round(value) - invested, status,
      ...(baseline ? { baseline } : {}),
    });
    holdings.push({ date: ds, holdings: dayHoldings });
    prevDs = ds;
    day.setDate(day.getDate() + 1);
  }
  return { series, holdings };
}

export async function buildDailySeries(): Promise<PnlPoint[]> {
  return (await buildDaily()).series;
}

/** The day before `iso`, in UTC arithmetic so a DST boundary can't shift it. */
function isoPrevDay(iso: string): string {
  return new Date(new Date(`${iso}T00:00:00Z`).valueOf() - 86400000).toISOString().slice(0, 10);
}

/**
 * Today's point alone, without reconstructing the days behind it.
 *
 * `buildDaily` walks every day from the first transaction to now, and the dashboard asks
 * for the last point again on every live-price tick — so that walk was being repeated in
 * full, hundreds of times an hour, to keep one day. This computes the same point directly.
 *
 * It can, because on the final day the per-instrument unit count collapses to a constant.
 * Every event dated on or before today has been consumed by then, so `cumUnits` is the
 * whole of `totalUnits`, and with `offset = qtyNow - totalUnits` the expression
 *
 *     units = max(offset + cumUnits, 0)
 *
 * reduces to `max(qtyNow - futureUnits, 0)` — no history required. The rest of the day's
 * figures need only today's and yesterday's closes. `held`/`settled`/`lastClose` drop out
 * entirely: they exist to decide `status`, which is unconditionally "live" on this day.
 *
 * **This must agree with `buildDaily().series.at(-1)` exactly.** Two details are easy to
 * lose: the aggregate value sums the *unrounded* per-instrument values and rounds once at
 * the end, while each holding row carries the *rounded* one; and a holding is emitted only
 * when its value or its move is non-zero. Change either function and re-check the other.
 */
export async function buildLatest(): Promise<{
  point: PnlPoint | null;
  holdings: HoldingPnlPoint | null;
}> {
  const end = todayIso();
  const [rollups, closes, instruments, sources] = await Promise.all([
    txRollup(end),
    recentCloses(end),
    listInstruments(),
    listPriceSources(),
  ]);
  // No transactions at all — `buildDaily` returns an empty series for this.
  if (!rollups.length) return { point: null, holdings: null };

  const firstTx = rollups.reduce((min, r) => (r.first_date < min ? r.first_date : min), rollups[0].first_date);
  // Every transaction still in the future: `buildDaily`'s loop breaks before its first
  // iteration, so there is no series and therefore no latest point.
  if (firstTx > end) return { point: null, holdings: null };
  // What the day's move is measured against. Empty when today *is* the first day, matching
  // the `prevDs = ""` the day loop starts with — there is no previous day to compare to.
  const prevDs = firstTx < end ? isoPrevDay(end) : "";

  const strategyBySource = new Map(sources.map((s) => [s.key, s.history_strategy]));
  const rollupBy = new Map(rollups.map((r) => [r.instrument, r]));
  const closeBy = new Map<string, { date: string; price: number }[]>();
  for (const c of closes) {
    const arr = closeBy.get(c.instrument);
    if (arr) arr.push(c);
    else closeBy.set(c.instrument, [c]);
  }

  // Only two shapes of holding can't be settled from `instruments.quantity` alone: one with
  // no quantity of its own (its units are the sum of its transactions) and one holding
  // future-dated rows (which must be subtracted back off). Everything else skips this read.
  const needUnits: string[] = [];
  for (const inst of instruments) {
    const r = rollupBy.get(inst.name);
    if (!r || !closeBy.get(inst.name)?.length) continue;
    if (inst.quantity == null || r.future_count > 0) needUnits.push(inst.name);
  }
  const upTo = new Map<string, number>();
  const after = new Map<string, number>();
  for (const t of await txUnitPrices(needUnits)) {
    const px = t.px_at ?? t.px_first;
    const u = t.quantity != null ? t.quantity : px ? t.amount / px : 0;
    const bucket = t.date <= end ? upTo : after;
    bucket.set(t.instrument, (bucket.get(t.instrument) ?? 0) + u);
  }

  let value = 0;
  let invested = 0;
  for (const r of rollups) invested += r.invested;

  // `buildDaily` emits every tracked holding before every manual one, in instrument order.
  const trackedRows: HoldingDayPnl[] = [];
  const manualRows: HoldingDayPnl[] = [];
  let baseline: string | undefined;

  for (const inst of instruments) {
    const r = rollupBy.get(inst.name);
    if (!r) continue; // no transactions — never enters the series
    const rows = closeBy.get(inst.name);

    if (rows?.length) {
      const today = rows[0];
      // `priceAt(prevDs)` / `anchorAt(prevDs)`: the newest close is the answer when it
      // already predates yesterday (the feed hasn't settled today), otherwise the one
      // behind it. With a single row dated today, `priceLookup` falls back to that row.
      const yest = today.date <= prevDs ? today : (rows[1] ?? today);

      const strat = strategyBySource.get(inst.price_source) ?? "none";
      const livePrice = NAV_STRATEGIES.has(strat) ? null : inst.last_price;
      const price = livePrice ?? today.price;

      const boughtToday = r.today_qty + (today.price ? r.today_amount_unqty / today.price : 0);
      const future = after.get(inst.name) ?? 0;
      const qtyNow = inst.quantity ?? (upTo.get(inst.name) ?? 0) + future;
      const units = Math.max(qtyNow - future, 0);
      const unitsYest = Math.max(qtyNow - future - boughtToday, 0);

      let raw = 0;
      if (end >= r.first_date && units) {
        raw = units * price;
        // Only a live-priced holding that actually moved can widen the span back past
        // yesterday — see the long note in `buildDaily`.
        if (livePrice != null && prevDs && price !== yest.price)
          if (baseline === undefined || yest.date < baseline) baseline = yest.date;
      }
      value += raw;
      const v = Math.round(raw);
      const vYest = prevDs && prevDs >= r.first_date && unitsYest ? Math.round(unitsYest * yest.price) : 0;
      const pnl = v - vYest - r.today_amount;
      if (v !== 0 || pnl !== 0)
        trackedRows.push({ name: inst.name, type: inst.asset_type, value: v, pnl });
    } else {
      // No close on or before today: valued at its static figure, as `buildDaily`'s
      // `manual` branch does.
      const mv = inst.manual_value ?? 0;
      const v = end >= r.first_date ? mv : 0;
      const vYest = prevDs && prevDs >= r.first_date ? mv : 0;
      value += v;
      const pnl = v - vYest - r.today_amount;
      if (v !== 0 || pnl !== 0)
        manualRows.push({ name: inst.name, type: inst.asset_type, value: v, pnl });
    }
  }

  const rounded = Math.round(value);
  return {
    point: {
      date: end, invested, value: rounded, pnl: rounded - invested, status: "live",
      ...(baseline ? { baseline } : {}),
    },
    holdings: { date: end, holdings: [...trackedRows, ...manualRows] },
  };
}
