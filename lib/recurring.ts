/**
 * Schedule maths for recurring rules. Pure — safe on client and server.
 *
 * Self-check: `node scripts/check-recurring.mjs`.
 *
 * Like subscriptions, every run is counted forward from `start_date` rather than chained
 * off the previous one, so a rule anchored on the 31st lands on the 31st again in every
 * long month instead of drifting down to the 28th for good.
 */
import { cronMatches, parseCron } from "./cron";
import { CRON_FREQ, type RecurringFreq } from "./types";

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

/** Whether a day matches a cron rule — or null if the expression doesn't parse. A rule runs
 *  once a day at most, so minute and hour are ignored: any member of each will do. */
function cronDays(expr: string | null | undefined): ((d: Date) => boolean) | null {
  let p;
  try {
    p = parseCron(expr ?? "");
  } catch {
    return null;
  }
  const [min] = p.sets[0];
  const [hour] = p.sets[1];
  return (d) => cronMatches(p, [min, hour, d.getDate(), d.getMonth() + 1, d.getDay()]);
}

/** Runs a year on average, over four years so a leap day and every weekday count fairly. */
function cronPerYear(expr: string | null | undefined): number {
  const matches = cronDays(expr);
  if (!matches) return 0;
  let n = 0;
  for (let d = new Date(2024, 0, 1); d.getFullYear() < 2028; d.setDate(d.getDate() + 1))
    if (matches(d)) n++;
  return n / 4;
}

/** One rule's ₫/month. */
export function ruleMonthly(r: { amount: number; freq: string; cron?: string | null }): number {
  const perYear = r.freq === CRON_FREQ ? cronPerYear(r.cron) : PER_YEAR[freqOf(r.freq)];
  return (r.amount * perYear) / 12;
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

/** Every run strictly after `after` (if set), from `start` up to and including `until`.
 *  A cron rule whose expression doesn't parse never runs (the form refuses one anyway). */
export function* occurrences(
  freq: string, start: Date, after: Date | null, until: Date, cron?: string | null,
): Generator<Date> {
  if (freq === CRON_FREQ) {
    const matches = cronDays(cron);
    if (!matches) return;
    const d = after && after >= start
      ? new Date(after.getFullYear(), after.getMonth(), after.getDate() + 1)
      : new Date(start.getFullYear(), start.getMonth(), start.getDate());
    for (; d <= until; d.setDate(d.getDate() + 1)) if (matches(d)) yield new Date(d);
    return;
  }
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
