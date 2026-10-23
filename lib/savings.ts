/** Interest maths for term deposits and debts. Pure — safe on client and server. */

import type { TermUnit } from "./types";

/** Anything that accrues interest over a fixed term (savings deposit or loan). */
export interface Accruing {
  principal: number;
  rate: number;
  start_date: string;
  /** The term's length in `term_unit` (months when unset — debts never set it). */
  term_months: number;
  term_unit?: TermUnit;
  interest_type: string;
  /** Dated top-ups (+) and withdrawals (−) after the start, if any — only deposits have them. */
  movements?: { date: string; amount: number }[];
}

const DAY_MS = 86_400_000;

/** Add whole months to an ISO date, clamping the day to the month's length. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, lastDay));
  return base.toISOString().slice(0, 10);
}

export function maturityDate(s: Pick<Accruing, "start_date" | "term_months" | "term_unit">): string {
  const n = s.term_months;
  if (s.term_unit === "day" || s.term_unit === "week") {
    const days = s.term_unit === "week" ? n * 7 : n;
    return new Date(Date.parse(s.start_date + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);
  }
  return addMonths(s.start_date, s.term_unit === "year" ? n * 12 : n);
}

/** The term in years, for the closed-form maturity value. Months and years stay exact
 *  fractions of a year, as they always were; days and weeks count actual days. */
function termYears(s: Accruing): number {
  if (s.term_unit === "year") return s.term_months;
  if (s.term_unit === "day" || s.term_unit === "week")
    return (Date.parse(maturityDate(s) + "T00:00:00Z") - Date.parse(s.start_date + "T00:00:00Z")) / DAY_MS / 365;
  return s.term_months / 12;
}

/** Revolving = open-ended (e.g. credit card): no fixed term, interest never stops. */
export function isRevolving(s: Pick<Accruing, "term_months">): boolean {
  return s.term_months <= 0;
}

/** Value after `years` at the given annual rate (%). */
function accrue(principal: number, ratePct: number, years: number, type: string): number {
  const r = ratePct / 100;
  if (type === "compound") return principal * Math.pow(1 + r / 12, years * 12);
  return principal * (1 + r * years);
}

/** Full value at the end of the term (for revolving debt, the value as of today). */
export function maturityValue(s: Accruing): number {
  if (isRevolving(s)) return currentValue(s);
  if (s.movements?.length) return currentValue(s, new Date(maturityDate(s) + "T00:00:00Z"));
  return accrue(s.principal, s.rate, termYears(s), s.interest_type);
}

/** Estimated value today. Fixed-term items accrue up to maturity then stay flat;
 *  revolving items keep accruing indefinitely.
 *
 *  Each movement is its own tranche at the same rate, from its date to maturity: a top-up
 *  starts earning the day it lands, and a withdrawal stops earning the day it leaves while
 *  the interest it earned before stays. Tranches rather than a running balance so simple
 *  interest stays simple. Floored at 0: a full withdrawal of a simple deposit drifts a hair
 *  below it. */
export function currentValue(s: Accruing, today = new Date()): number {
  const start = Date.parse(s.start_date + "T00:00:00Z");
  const cap = isRevolving(s) ? Infinity : Date.parse(maturityDate(s) + "T00:00:00Z");
  const elapsedTo = Math.max(today.getTime(), start);
  const years = (Math.min(elapsedTo, cap) - start) / DAY_MS / 365;
  const base = accrue(s.principal, s.rate, years, s.interest_type);
  if (!s.movements?.length) return base;
  const moved = s.movements.reduce((a, m) => {
    const t = Date.parse(m.date + "T00:00:00Z");
    if (!(t <= today.getTime())) return a;
    const y = Math.max(0, Math.min(today.getTime(), cap) - t) / DAY_MS / 365;
    return a + accrue(m.amount, s.rate, y, s.interest_type);
  }, 0);
  return Math.max(0, base + moved);
}

/** What you've put in and not taken out, as of `today`: the principal plus every movement
 *  up to then. The baseline interest is measured against. */
export function netPrincipal(s: Accruing, today = new Date()): number {
  return (s.movements ?? []).reduce(
    (a, m) => (Date.parse(m.date + "T00:00:00Z") <= today.getTime() ? a + m.amount : a),
    s.principal,
  );
}

export function isMatured(s: Pick<Accruing, "start_date" | "term_months" | "term_unit">, today = new Date()): boolean {
  if (isRevolving(s)) return false;
  return today.getTime() >= Date.parse(maturityDate(s) + "T00:00:00Z");
}

/** A repayment against a debt. */
export interface Payment {
  date: string;
  amount: number;
}

/** True if any payment was recorded in the current calendar month. */
export function paidThisMonth(payments: Payment[], today = new Date()): boolean {
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  return payments.some((p) => p.date.slice(0, 7) === key);
}

/**
 * Amount still owed today using the declining-balance method: interest accrues on the
 * outstanding balance between payments, each payment reduces the balance (floored at 0).
 * Fixed-term debts stop accruing interest at maturity; revolving debts accrue to today.
 *
 * `today` is a real as-of date, not just "now": the chart replays this per day, so a
 * payment that hasn't happened yet on that date must not reduce the balance.
 */
export function owed(d: Accruing, payments: Payment[] = [], today = new Date()): number {
  const start = Date.parse(d.start_date + "T00:00:00Z");
  const cap = isRevolving(d) ? Infinity : Date.parse(maturityDate(d) + "T00:00:00Z");
  const asOf = Math.max(today.getTime(), start);

  const events = payments
    .map((p) => ({ t: Date.parse(p.date + "T00:00:00Z"), amt: p.amount }))
    .filter((e) => !Number.isNaN(e.t) && e.t <= asOf)
    .sort((a, b) => a.t - b.t);

  let balance = d.principal;
  let cursor = start;
  const grow = (from: number, to: number) => {
    if (to > from) balance = accrue(balance, d.rate, (to - from) / DAY_MS / 365, d.interest_type);
  };

  for (const e of events) {
    grow(cursor, Math.min(e.t, cap));
    cursor = Math.max(cursor, e.t);
    balance = Math.max(0, balance - e.amt);
  }
  grow(cursor, Math.min(asOf, cap));
  return Math.max(0, balance);
}

/**
 * Amount owed on a debt, respecting its `kind`:
 * - `fixed`    — interest accrues on the ORIGINAL principal to maturity; payments only
 *   reduce the balance (early payment does NOT reduce interest).
 * - `flexible` — fixed term, reducing-balance: interest is recomputed on the remaining
 *   balance after each payment (early payment saves interest).
 * - `credit`   — open-ended card/line: the entered principal IS the current statement
 *   balance, reduced by payments. It does NOT accrue interest against wall-clock time
 *   (the balance is a snapshot you refresh from your statement), so the figure stays
 *   put; what's due each period is the fixed `monthly_payment`, shown separately.
 */
export function debtOwed(
  d: Accruing & { kind?: string },
  payments: Payment[] = [],
  today = new Date(),
): number {
  const nowMs = today.getTime();
  const paidToDate = () =>
    payments
      .filter((p) => Date.parse(p.date + "T00:00:00Z") <= nowMs)
      .reduce((a, p) => a + p.amount, 0);

  // Credit / revolving: outstanding balance is a snapshot, not a compounding curve.
  if (d.kind === "credit" || isRevolving(d)) {
    return Math.max(0, d.principal - paidToDate());
  }

  if (d.kind === "fixed") {
    const start = Date.parse(d.start_date + "T00:00:00Z");
    const end = Math.min(Math.max(nowMs, start), Date.parse(maturityDate(d) + "T00:00:00Z"));
    const gross = accrue(d.principal, d.rate, (end - start) / DAY_MS / 365, d.interest_type);
    return Math.max(0, gross - paidToDate());
  }

  return owed(d, payments, today);
}

export interface AccruingSummary {
  principal: number;
  currentValue: number;
  interest: number;
  maturityValue: number;
}

export function summarize(items: Accruing[], today = new Date()): AccruingSummary {
  const principal = items.reduce((a, s) => a + netPrincipal(s, today), 0);
  const cur = items.reduce((a, s) => a + currentValue(s, today), 0);
  const mat = items.reduce((a, s) => a + maturityValue(s), 0);
  return { principal, currentValue: cur, interest: cur - principal, maturityValue: mat };
}
