/**
 * Billing-cycle maths for subscriptions. Pure — safe on client and server.
 *
 * Every charge is counted forward from `start_date` (`chargeAt(s, k)`) rather than chained
 * off the previous one. That is what keeps a plan billing on the 31st: chaining would walk
 * it 31 → 28 → 28 and it could never climb back, while counting `k` months from the start
 * clamps only the short months and lands on the 31st again in the long ones.
 */
import { addMonths } from "./savings";
import type { BillingCycle } from "./types";

const DAY_MS = 86_400_000;

/** How many times a year each cycle bills. Weekly is 52 rather than 365.25/7 — the same
 *  figure `plannedMonthly` in lib/db.ts uses for a weekly recurring rule, so a weekly
 *  subscription and a weekly investment rule can't quote different monthly equivalents. */
export const PERIODS_PER_YEAR: Record<BillingCycle, number> = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

/** Months between charges. Weekly has none — it's stepped in days. */
const CYCLE_MONTHS: Record<BillingCycle, number> = {
  weekly: 0,
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/** What a recurring charge needs to be projected: price, rhythm, start, and its end. */
export interface Billable {
  amount: number;
  cycle: BillingCycle;
  start_date: string;
  /** Set once cancelled — no charge falls after it. */
  cancelled_date: string | null;
}

export function isCancelled(s: Pick<Billable, "cancelled_date">): boolean {
  return s.cancelled_date != null;
}

/** ₫/month, the one figure that makes a weekly plan and a yearly one comparable. */
export function monthlyCost(s: Pick<Billable, "amount" | "cycle">): number {
  return (s.amount * PERIODS_PER_YEAR[s.cycle]) / 12;
}

/** ₫/year — what committing to this plan costs over twelve months. */
export function yearlyCost(s: Pick<Billable, "amount" | "cycle">): number {
  return s.amount * PERIODS_PER_YEAR[s.cycle];
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
}

/** The date of the `k`th charge, counting the first one as 0. */
export function chargeAt(s: Pick<Billable, "cycle" | "start_date">, k: number): string {
  return s.cycle === "weekly"
    ? addDays(s.start_date, k * 7)
    : addMonths(s.start_date, k * CYCLE_MONTHS[s.cycle]);
}

/**
 * How many charges have fallen strictly before `date` — exact for weekly, and within one
 * either way for the month-based cycles, where `addMonths` clamps the day. Every caller
 * treats it as a starting guess and walks the last step or two itself.
 */
function periodsBefore(s: Pick<Billable, "cycle" | "start_date">, date: string): number {
  if (s.cycle === "weekly") {
    const ms = Date.parse(date + "T00:00:00Z") - Date.parse(s.start_date + "T00:00:00Z");
    return Math.max(0, Math.floor(ms / (7 * DAY_MS)));
  }
  const [sy, sm] = s.start_date.split("-").map(Number);
  const [y, m] = date.split("-").map(Number);
  return Math.max(0, Math.floor(((y - sy) * 12 + (m - sm)) / CYCLE_MONTHS[s.cycle]));
}

/** Index of the first charge landing on or after `date`. `chargeAt` is non-decreasing in
 *  `k` (clamping never moves a charge backwards), so walking off the guess is safe. */
function firstChargeFrom(s: Pick<Billable, "cycle" | "start_date">, date: string): number {
  let k = periodsBefore(s, date);
  while (chargeAt(s, k) < date) k += 1;
  while (k > 0 && chargeAt(s, k - 1) >= date) k -= 1;
  return k;
}

/** The next charge on or after `today`, or null when there'll never be another one. */
export function nextRenewal(s: Billable, today: string): string | null {
  if (s.cancelled_date != null) return null;
  if (s.start_date >= today) return s.start_date;
  return chargeAt(s, firstChargeFrom(s, today));
}

/** Whole days from `today` to `iso` — negative once it's in the past. */
export function daysUntil(iso: string, today: string): number {
  return Math.round(
    (Date.parse(iso + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / DAY_MS,
  );
}

/** Every charge falling in `[from, to]` inclusive, respecting the start and cancellation. */
export function chargesBetween(s: Billable, from: string, to: string): string[] {
  const stop = s.cancelled_date != null && s.cancelled_date < to ? s.cancelled_date : to;
  const out: string[] = [];
  let k = firstChargeFrom(s, from > s.start_date ? from : s.start_date);
  for (;;) {
    const d = chargeAt(s, k);
    if (d > stop) return out;
    if (d >= from) out.push(d);
    k += 1;
  }
}

/**
 * What this plan has billed you from its first charge through `today`, capped at
 * cancellation. Counted, not stored: the ledger of past charges is fully determined by the
 * schedule, so there is nothing here to keep in sync.
 */
export function spentToDate(s: Billable, today: string): number {
  const stop = s.cancelled_date != null && s.cancelled_date < today ? s.cancelled_date : today;
  if (stop < s.start_date) return 0;
  // Index of the last charge on or before `stop`; +1 because the first charge is index 0.
  let k = periodsBefore(s, stop);
  while (k > 0 && chargeAt(s, k) > stop) k -= 1;
  while (chargeAt(s, k + 1) <= stop) k += 1;
  return (k + 1) * s.amount;
}

export interface SubscriptionSummary {
  /** ₫/month across everything still billing. */
  monthly: number;
  /** ₫/year across everything still billing. */
  yearly: number;
  active: number;
  cancelled: number;
  /** Lifetime spend, cancelled plans included — that money went out too. */
  spent: number;
}

export function summarize(subs: Billable[], today: string): SubscriptionSummary {
  const live = subs.filter((s) => s.cancelled_date == null);
  return {
    monthly: live.reduce((a, s) => a + monthlyCost(s), 0),
    yearly: live.reduce((a, s) => a + yearlyCost(s), 0),
    active: live.length,
    cancelled: subs.length - live.length,
    spent: subs.reduce((a, s) => a + spentToDate(s, today), 0),
  };
}

export interface ForecastMonth {
  /** `YYYY-MM`. */
  month: string;
  total: number;
}

/**
 * What each of the next `months` calendar months bills, starting with the month `today`
 * falls in.
 *
 * Whole months, including the current one in full — charges it has already taken as well as
 * the ones still ahead. A part-month first bar would be shorter than every bar beside it
 * for a reason that has nothing to do with the plans, and you'd have to correct for it by
 * hand every time you looked. The point of the series is where the lumps are: an annual
 * renewal sits in one month and is invisible in a ₫/month figure.
 */
export function monthlyForecast(subs: Billable[], today: string, months = 12): ForecastMonth[] {
  const first = `${today.slice(0, 8)}01`;
  const out: ForecastMonth[] = [];
  for (let i = 0; i < months; i += 1) {
    const from = addMonths(first, i);
    const to = addDays(addMonths(first, i + 1), -1);
    out.push({
      month: from.slice(0, 7),
      total: subs.reduce((a, s) => a + chargesBetween(s, from, to).length * s.amount, 0),
    });
  }
  return out;
}
