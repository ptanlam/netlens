/** Interest maths for term deposits and debts. Pure — safe on client and server. */

/** Anything that accrues interest over a fixed term (savings deposit or loan). */
export interface Accruing {
  principal: number;
  rate: number;
  start_date: string;
  term_months: number;
  interest_type: string;
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

export function maturityDate(s: Pick<Accruing, "start_date" | "term_months">): string {
  return addMonths(s.start_date, s.term_months);
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
  return accrue(s.principal, s.rate, s.term_months / 12, s.interest_type);
}

/** Estimated value today. Fixed-term items accrue up to maturity then stay flat;
 *  revolving items keep accruing indefinitely. */
export function currentValue(s: Accruing, today = new Date()): number {
  const start = Date.parse(s.start_date + "T00:00:00Z");
  const elapsedTo = Math.max(today.getTime(), start);
  const capped = isRevolving(s)
    ? elapsedTo
    : Math.min(elapsedTo, Date.parse(maturityDate(s) + "T00:00:00Z"));
  const years = (capped - start) / DAY_MS / 365;
  return accrue(s.principal, s.rate, years, s.interest_type);
}

export function isMatured(s: Pick<Accruing, "start_date" | "term_months">, today = new Date()): boolean {
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
 */
export function owed(d: Accruing, payments: Payment[] = [], today = new Date()): number {
  const start = Date.parse(d.start_date + "T00:00:00Z");
  const cap = isRevolving(d) ? Infinity : Date.parse(maturityDate(d) + "T00:00:00Z");

  const events = payments
    .map((p) => ({ t: Date.parse(p.date + "T00:00:00Z"), amt: p.amount }))
    .filter((e) => !Number.isNaN(e.t))
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
  grow(cursor, Math.min(Math.max(today.getTime(), start), cap));
  return Math.max(0, balance);
}

/**
 * Amount owed on a debt, respecting its `kind`:
 * - `fixed`    — interest accrues on the ORIGINAL principal to maturity; payments only
 *   reduce the balance (early payment does NOT reduce interest).
 * - `flexible` — fixed term, reducing-balance: interest is recomputed on the remaining
 *   balance after each payment (early payment saves interest).
 * - `credit`   — open-ended credit account (monthly payment required): reducing-balance,
 *   never matures.
 */
export function debtOwed(
  d: Accruing & { kind?: string },
  payments: Payment[] = [],
  today = new Date(),
): number {
  if (d.kind === "fixed" && !isRevolving(d)) {
    const start = Date.parse(d.start_date + "T00:00:00Z");
    const end = Math.min(Math.max(today.getTime(), start), Date.parse(maturityDate(d) + "T00:00:00Z"));
    const gross = accrue(d.principal, d.rate, (end - start) / DAY_MS / 365, d.interest_type);
    const nowMs = today.getTime();
    const paid = payments
      .filter((p) => Date.parse(p.date + "T00:00:00Z") <= nowMs)
      .reduce((a, p) => a + p.amount, 0);
    return Math.max(0, gross - paid);
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
  const principal = items.reduce((a, s) => a + s.principal, 0);
  const cur = items.reduce((a, s) => a + currentValue(s, today), 0);
  const mat = items.reduce((a, s) => a + maturityValue(s), 0);
  return { principal, currentValue: cur, interest: cur - principal, maturityValue: mat };
}
