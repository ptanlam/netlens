/**
 * How volatile your holdings have actually been — not a prediction of what they'll do next.
 * Bootstraps each held instrument's own monthly returns, weighted by today's mix, instead of
 * asserting a rate. Pure and client-safe; runs where `applyGrowth` runs.
 */

import type { ForecastPoint } from "./forecast";

/** Minimum monthly return observations before an instrument's own history is trusted enough to
 *  bootstrap from. Below this the sample is too thin to mean anything. */
export const MIN_MONTHS = 6;

/** How far back to sample from. Recent enough to reflect how these holdings trade now, and it
 *  keeps the read bounded as `price_history` grows. */
export const LOOKBACK_MONTHS = 36;

/** Monte Carlo paths. Cheap at this horizon (paths × 60 months × a handful of instruments), and
 *  plenty for stable percentiles. */
export const PATHS = 2000;

/** Fixed, not random-per-render: the same holdings and the same history should draw the same
 *  band every time, not jitter on every reload. */
const SEED = 1;

/** One instrument's contribution to the simulated walk. */
export interface ReturnSeries {
  name: string;
  /** `value / totalInvestments` — deliberately *not* renormalized to sum to 1 across only the
   *  included instruments. That's what lets an excluded instrument's value ride along in the
   *  walk at implicitly 0% variance instead of vanishing from the total or wrongly inheriting
   *  the volatility of instruments it isn't. */
  weight: number;
  /** Historical monthly simple returns, resampled with replacement. */
  returns: number[];
}

export interface PortfolioReturns {
  included: ReturnSeries[];
  /** Instruments with under `MIN_MONTHS` of usable history — still counted in the total, just
   *  not in the sampling pool. Named here so the UI can say so. */
  excluded: { name: string; value: number }[];
  /** Included value as a fraction of total investments, 0..1 — for the UI note. */
  coverage: number;
}

/** Daily closes, one per calendar month — the last close on or before each month's end, same
 *  "last close at/before" convention `priceAt` uses elsewhere. Assumes `history` is sorted
 *  ascending by date, which is how `priceHistoryByInstrument` returns it. */
function monthlyCloses(history: [string, number][]): [string, number][] {
  const out: [string, number][] = [];
  for (const point of history) {
    const month = point[0].slice(0, 7);
    if (out.length > 0 && out[out.length - 1][0].slice(0, 7) === month) out[out.length - 1] = point;
    else out.push(point);
  }
  return out;
}

/** Simple returns between consecutive available month-closes. No gap-filling: a data gap just
 *  means one bootstrap sample spans longer than a month, which is an acceptable approximation
 *  for a handful of personal holdings. */
export function monthlyReturns(history: [string, number][]): number[] {
  const closes = monthlyCloses(history);
  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1][1];
    if (prev > 0) out.push(closes[i][1] / prev - 1);
  }
  return out;
}

/** Weight and sample each currently-held instrument's own historical returns. */
export function buildPortfolioReturns(
  holdings: { name: string; value: number }[],
  historyByInstrument: Record<string, [string, number][]>,
): PortfolioReturns {
  const total = holdings.reduce((a, h) => a + h.value, 0);
  const included: ReturnSeries[] = [];
  const excluded: { name: string; value: number }[] = [];
  for (const h of holdings) {
    if (h.value <= 0) continue;
    const returns = monthlyReturns(historyByInstrument[h.name] ?? []);
    if (returns.length >= MIN_MONTHS && total > 0)
      included.push({ name: h.name, weight: h.value / total, returns });
    else excluded.push({ name: h.name, value: h.value });
  }
  const coverage = total > 0 ? included.reduce((a, s) => a + s.weight, 0) : 0;
  return { included, excluded, coverage };
}

/** mulberry32 — small, seeded, dependency-free. Deterministic so the band doesn't jitter
 *  between renders of the same data. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export interface BandPoint extends ForecastPoint {
  /** Net worth at the 10th percentile across simulated paths. */
  p10: number;
  /** Median across simulated paths. */
  p50: number;
  /** Net worth at the 90th percentile across simulated paths. */
  p90: number;
}

/**
 * Simulate the investments+pace leg forward, path by path, and read off percentiles.
 *
 * Only investments and the pace are stochastic — savings accrue and debts amortise on their
 * own contracted terms, exactly as `applyGrowth` leaves them alone, so the band isolates the
 * one thing that's actually uncertain.
 */
export function simulateBand(
  points: ForecastPoint[],
  pace: number,
  pr: PortfolioReturns,
  paths: number = PATHS,
): BandPoint[] {
  const months = points.length - 1;
  const next = rng(SEED);
  // One value-at-month-i array per path, filled path by path so each walk stays a single
  // contiguous simulation rather than being rebuilt column by column.
  const byMonth: number[][] = Array.from({ length: points.length }, () => []);
  const start = points[0]?.investments ?? 0;

  for (let p = 0; p < paths; p += 1) {
    let v = start;
    byMonth[0].push(v);
    for (let i = 1; i <= months; i += 1) {
      let r = 0;
      for (const s of pr.included) {
        const draw = s.returns[Math.floor(next() * s.returns.length)];
        r += s.weight * draw;
      }
      v = v * (1 + r) + pace;
      byMonth[i].push(v);
    }
  }

  return points.map((point, i) => {
    const invested = byMonth[i].map((v) => v + point.savings + point.fundCash - point.debts).sort((a, b) => a - b);
    return {
      ...point,
      p10: percentile(invested, 0.1),
      p50: percentile(invested, 0.5),
      p90: percentile(invested, 0.9),
    };
  });
}
