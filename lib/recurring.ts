/**
 * Schedule maths for recurring rules. Pure — safe on client and server.
 *
 * Self-check: `node scripts/check-recurring.mjs`.
 *
 * Like subscriptions, every run is counted forward from `start_date` rather than chained
 * off the previous one, so a rule anchored on the 31st lands on the 31st again in every
 * long month instead of drifting down to the 28th for good.
 */
import type { RecurringFreq } from "./types";

/** How a frequency steps: a fixed number of days, or of calendar months. */
const STEP: Record<RecurringFreq, { days: number } | { months: number }> = {
  daily: { days: 1 },
  weekly: { days: 7 },
  biweekly: { days: 14 },
  monthly: { months: 1 },
  quarterly: { months: 3 },
  semiannually: { months: 6 },
  yearly: { months: 12 },
};

/** Runs a year. Weekly is 52 rather than 365.25/7 — the same figure `PERIODS_PER_YEAR` in
 *  lib/subscriptions.ts uses, so a weekly subscription and a weekly rule can't quote
 *  different monthly equivalents. */
const PER_YEAR: Record<RecurringFreq, number> = {
  daily: 365,
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
  semiannually: 2,
  yearly: 1,
};

/** Anything unknown (a hand-edited row) reads as monthly — the rule still runs. */
function freqOf(freq: string): RecurringFreq {
  return freq in STEP ? (freq as RecurringFreq) : "monthly";
}

/** One rule's ₫/month. */
export function ruleMonthly(r: { amount: number; freq: string }): number {
  return (r.amount * PER_YEAR[freqOf(r.freq)]) / 12;
}

/** Whole days between two local dates, immune to a DST shift in between. */
function daysBetween(a: Date, b: Date): number {
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000,
  );
}

/** The k-th run: `start` plus k steps, the day clamped to the month for month steps. */
function runAt(freq: RecurringFreq, start: Date, k: number): Date {
  const step = STEP[freq];
  if ("days" in step)
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + k * step.days);
  const m = start.getMonth() + k * step.months;
  const daysInMonth = new Date(start.getFullYear(), m + 1, 0).getDate();
  return new Date(start.getFullYear(), m, Math.min(start.getDate(), daysInMonth));
}

/** Every run strictly after `after` (if set), from `start` up to and including `until`. */
export function* occurrences(
  freq: string, start: Date, after: Date | null, until: Date,
): Generator<Date> {
  const f = freqOf(freq);
  const step = STEP[f];
  let k = 0;
  // Skip straight past `after` rather than walking a daily rule's whole history.
  if (after && after >= start) {
    const days = daysBetween(start, after);
    k = "days" in step
      ? Math.floor(days / step.days) + 1
      : Math.max(0, Math.floor(days / 31 / step.months));
  }
  for (;; k++) {
    const occ = runAt(f, start, k);
    if (occ > until) return;
    if (!after || occ > after) yield occ;
  }
}
