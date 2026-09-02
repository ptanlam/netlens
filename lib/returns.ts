/**
 * Return measurement: what the holdings did, and what you actually got.
 *
 * Pure (no Node deps), like `lib/goals.ts` and `lib/score.ts` — the client computes these
 * from the P&L series it already holds, so nothing here costs a query.
 *
 * Two figures, and the whole point is that they differ:
 *
 *  - **Time-weighted (TWR)** chains each day's return with contributions divided out. It is
 *    what the holdings did, and it is deliberately blind to how much money you had in at
 *    the time — which is what makes it comparable to a fund's published figure.
 *  - **Money-weighted (MWR / XIRR)** solves the rate that makes your actual dated cashflows
 *    add up to what you hold today. It is what *you* earned, and it moves when you buy.
 *
 * The gap between them is your timing, and it is the only number here you can act on: TWR
 * is what the market did to you, MWR is what you did with it — the same split the streak
 * draws between the portfolio chart and its own columns.
 *
 * Nothing is stored and nothing is annualized that shouldn't be. A return measured over
 * six weeks says nothing about a year, so below `MIN_ANNUALIZE_DAYS` the annual figures are
 * null and the caller shows the plain cumulative one instead. Compounding a good fortnight
 * into "+412% a year" is the single easiest way for this app to lie.
 */

const DAY_MS = 86_400_000;

/** Under this, a period is too short for an annual rate to mean anything and both annual
 *  figures come back null. Six months: long enough that one lucky week can't dominate. */
export const MIN_ANNUALIZE_DAYS = 180;

/** One day of the reconstruction. `invested` is the cumulative cost basis (sells subtracted),
 *  `value` the portfolio's worth that day — exactly `PnlPoint`. */
export interface ReturnPoint {
  date: string;
  invested: number;
  value: number;
}

/** A dated cashflow, from your side: positive is money you put in. */
export interface Flow {
  date: string;
  amount: number;
}

export interface ReturnStats {
  from: string;
  to: string;
  days: number;
  /** Cumulative time-weighted return over the whole period, as a fraction (0.12 = +12%). */
  twr: number;
  /** TWR as an annual rate — null when the period is shorter than `MIN_ANNUALIZE_DAYS`. */
  twrAnnual: number | null;
  /** Money-weighted return (XIRR), always an annual rate. Null when the period is too short
   *  to annualize, or when the flows don't bracket a solution. */
  mwr: number | null;
  /** `mwr − twrAnnual`: what your timing added (or cost) on top of what the holdings did.
   *  Null unless both halves exist, since a difference of two rates over different periods
   *  would be meaningless. */
  timing: number | null;
  /** Cost basis and worth at the end of the period — the two figures the rates explain. */
  invested: number;
  value: number;
}

/** Whole days between two ISO dates. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY_MS);
}

/** Fractional years, on the same 365-day basis `lib/savings.ts` accrues interest over. */
function yearsBetween(from: string, to: string): number {
  return daysBetween(from, to) / 365;
}

/**
 * Cumulative time-weighted return, and the span it covers.
 *
 * Each day's factor is `value / (yesterday's value + today's contribution)`: the money you
 * added is in the denominator, so putting ₫10mil in never reads as a 10mil gain. A day with
 * nothing at risk (the first day, or after selling out) is skipped rather than counted as
 * flat — an empty portfolio has no return, and dividing by its zero would produce one.
 */
export function timeWeighted(points: ReturnPoint[]): { cumulative: number; days: number } | null {
  if (points.length < 2) return null;
  let factor = 1;
  let counted = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const base = prev.value + (cur.invested - prev.invested);
    if (base <= 0) continue;
    factor *= cur.value / base;
    counted += 1;
  }
  if (counted === 0) return null;
  return { cumulative: factor - 1, days: daysBetween(points[0].date, points[points.length - 1].date) };
}

/**
 * The annual rate that discounts `flows` to zero — the internal rate of return.
 *
 * Solved by bisection rather than Newton's method: the NPV curve is monotonic in the range
 * that interests us but its derivative near −100% is savage, and a Newton step off a steep
 * flank lands outside the domain and returns NaN. Bisection cannot diverge, and 120 halvings
 * of the bracket is far more precision than a percentage figure will ever show.
 *
 * Null when the flows don't bracket a root — no sign change (everything in and nothing to
 * show for it, or vice versa), or every flow on one day.
 */
export function xirr(flows: Flow[]): number | null {
  if (flows.length < 2) return null;
  const t0 = flows[0].date;
  if (flows.every((f) => f.date === t0)) return null;
  const hasIn = flows.some((f) => f.amount > 0);
  const hasOut = flows.some((f) => f.amount < 0);
  if (!hasIn || !hasOut) return null;

  const npv = (rate: number) =>
    flows.reduce((a, f) => a + f.amount / Math.pow(1 + rate, yearsBetween(t0, f.date)), 0);

  // −99.99% to +10000%/yr. Wider than any real portfolio, and the point of a bracket is to
  // contain the answer, not to be plausible.
  let lo = -0.9999;
  let hi = 100;
  const flo = npv(lo);
  const fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null;
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (flo > 0 === fhi > 0) return null; // no sign change: nothing to converge on

  for (let i = 0; i < 120; i += 1) {
    const mid = (lo + hi) / 2;
    const f = npv(mid);
    if (!Number.isFinite(f)) return null;
    if (f > 0 === flo > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The cashflows behind a series: each day's net contribution, then what you hold at the end.
 *
 * Signs are from your pocket's point of view — a purchase is money *in* (positive), and the
 * final value is the money you'd get back, so it is negative. That is the convention `xirr`
 * needs a sign change from, and it makes the rate come out positive when you've done well.
 */
export function flowsOf(points: ReturnPoint[]): Flow[] {
  const flows: Flow[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const delta = points[i].invested - (i === 0 ? 0 : points[i - 1].invested);
    if (delta !== 0) flows.push({ date: points[i].date, amount: delta });
  }
  const last = points[points.length - 1];
  if (last) flows.push({ date: last.date, amount: -last.value });
  return flows;
}

/** Both rates over one series, or null when there isn't enough of it to measure. */
export function measure(points: ReturnPoint[]): ReturnStats | null {
  const twr = timeWeighted(points);
  if (!twr) return null;
  const last = points[points.length - 1];
  const long = twr.days >= MIN_ANNUALIZE_DAYS;
  const twrAnnual = long ? Math.pow(1 + twr.cumulative, 365 / twr.days) - 1 : null;
  // Gated on the same span as the TWR: XIRR *is* an annual rate, so a six-week window
  // compounds its luck just as hard — it simply hides the fact inside the solve.
  const mwr = long ? xirr(flowsOf(points)) : null;
  return {
    from: points[0].date,
    to: last.date,
    days: twr.days,
    twr: twr.cumulative,
    twrAnnual,
    mwr,
    timing: mwr != null && twrAnnual != null ? mwr - twrAnnual : null,
    invested: last.invested,
    value: last.value,
  };
}

/** One holding on one day, as `HoldingDayPnl` carries it: the day's value, and the day's
 *  move net of anything you put in. */
export interface HoldingDay {
  date: string;
  value: number;
  pnl: number;
}

/**
 * A holding's own series, recovered from the per-holding P&L breakdown.
 *
 * `lib/pnl.ts` computes each row as `pnl = value − yesterday's value − today's contribution`,
 * so the contribution comes back exactly: `value − yesterday's value − pnl`. All three are
 * the rounded integers the breakdown carries, so this is not an approximation.
 *
 * The breakdown omits a day where a holding is worth nothing and moved nothing — which can
 * only happen when yesterday was zero too (any move off a non-zero balance would show as
 * `pnl`), so the previous *present* row is always the right predecessor.
 */
export function holdingPoints(rows: HoldingDay[]): ReturnPoint[] {
  const points: ReturnPoint[] = [];
  let prevValue = 0;
  let invested = 0;
  for (const r of rows) {
    invested += r.value - prevValue - r.pnl;
    prevValue = r.value;
    points.push({ date: r.date, invested, value: r.value });
  }
  return points;
}
