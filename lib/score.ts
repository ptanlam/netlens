/**
 * The saving streak: which calendar months you moved your own money forward under your own
 * steam, and how many of them ran back to back.
 *
 * Pure (no Node deps), like `lib/goals.ts` — the server page computes it, the card renders it.
 *
 * Three rules the design turns on, all of them about not corrupting the data this app
 * exists to keep honest:
 *
 *  - **Nothing here is stored.** There is no `streak` column and no `points` ledger; every
 *    figure below is derived from dated rows on each request. So correcting a transaction
 *    from March correctly rewrites the streak, and you never have a counter you'd protect
 *    by leaving a mistake in place.
 *  - **Only money that moved counts.** Not opening the app, not logging a row. You enter
 *    your own data here, so anything that rewards *using* the app is farmable in one
 *    keystroke — and worse, it would pay you to type things that didn't happen.
 *  - **Market movement is excluded**, exactly as `lib/goals.ts` assumes zero return. A bull
 *    market must not hand you a streak and a crash must not break one. What's measured is
 *    the part you control.
 *
 * The unit is a **month**, not a day. Money in this app moves monthly — salary, deposits,
 * renewals, repayments — so a daily streak would punish you for an ordinary Tuesday on
 * which nothing was ever supposed to happen.
 */

import { isRevolving, maturityValue, type Accruing } from "./savings";
import { MONTHS } from "./format";
import type { DebtPayment, Goal, GoalContribution, Saving } from "./types";

/** How many months back the trailing average may reach to rescue a short month. */
const GRACE_WINDOW = 3;

/** `YYYY-MM`. The key everything here is bucketed by. */
export type MonthKey = string;

/** The four ways you can push your own net worth up in a month. One per page that already
 *  exists — which is the point: the streak reports on what you already track, and asks for
 *  nothing new to be typed. */
export const LEVERS = ["invest", "deposit", "fund", "debt"] as const;
export type Lever = (typeof LEVERS)[number];

export const LEVER_LABELS: Record<Lever, string> = {
  invest: "Invested",
  deposit: "Deposited",
  fund: "Set aside",
  debt: "Debt, ahead of plan",
};

/** Where the monthly bar came from. Named rather than inferred, so the card can say it —
 *  the same standard `PaceSource` holds itself to in `lib/goals.ts`. */
export type BarSource = "recurring" | "goals" | "none";

export type MonthStatus =
  /** Cleared the bar on its own. */
  | "met"
  /** Fell short, but the trailing average still clears it — a bonus paid in March that
   *  covers April is still saving, and lumpy income is not a lapse. */
  | "carried"
  | "missed"
  /** The current month, still in progress. Not a failure yet, and never counted as one. */
  | "open";

export type ScoredDebt = Accruing & {
  id: number;
  kind: string;
  monthly_payment: number | null;
};

export interface StreakWorld {
  /** ISO date the streak is anchored to — which month counts as "in progress". */
  today: string;
  /**
   * Net ₫ into investments per month (`SUM(amount) GROUP BY month`). **Signed**: a month of
   * net selling comes back negative and is left that way, which is what stops "sold a fund
   * to pay for a holiday" reading as a month of saving. Selling one holding to open a term
   * deposit nets to zero across this and `savings` instead of counting twice.
   */
  investedByMonth: Record<MonthKey, number>;
  savings: Pick<Saving, "start_date" | "principal">[];
  contributions: GoalContribution[];
  /** Every debt, settled ones included: their old repayments are still history, and
   *  dropping them would retroactively break months you actually made. */
  debts: ScoredDebt[];
  payments: DebtPayment[];
  bar: number;
  barSource: BarSource;
}

export interface StreakMonth {
  month: MonthKey;
  /** What the four levers came to. May be negative — a month of net selling. */
  total: number;
  levers: Record<Lever, number>;
  status: MonthStatus;
  /** Set only on a `carried` month: the trailing average that rescued it. */
  carriedBy?: number;
}

export interface Streak {
  bar: number;
  barSource: BarSource;
  /** Oldest → newest, from your first recorded month through the current one. */
  months: StreakMonth[];
  /** Consecutive met/carried months ending now. An in-progress month that hasn't cleared
   *  the bar yet neither extends nor breaks it. */
  current: number;
  best: number;
  /** The in-progress month — always the last of `months`. */
  now: StreakMonth;
  /** ₫ still needed this month for it to count. Zero once it's in.
   *
   *  This, and never a countdown, is what the card shows. "Your 14-month streak dies in 3
   *  days" is loss aversion pointed at a financial decision, and the decision it produces
   *  is a bad one. A shortfall is the same fact and happens to be a savings target. */
  shortfall: number;
}

// ---------- month arithmetic ----------

export function monthOf(iso: string): MonthKey {
  return iso.slice(0, 7);
}

function monthIndex(key: MonthKey): number {
  return Number(key.slice(0, 4)) * 12 + (Number(key.slice(5, 7)) - 1);
}

function monthKey(index: number): MonthKey {
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/** "2026-08" → "Aug". */
export function monthShort(key: MonthKey): string {
  return MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
}

/** "2026-08" → "Aug 2026". */
export function monthLong(key: MonthKey): string {
  return `${monthShort(key)} ${key.slice(0, 4)}`;
}

// ---------- the bar ----------

/**
 * What you have to clear in a month, and where that number came from.
 *
 * Deliberately *only* things you declared on purpose — a recurring rule, or a goal's
 * monthly plan. A trailing average of your own past would be a treadmill: it rises the
 * month after a good one, so you could never get ahead and never quite fall behind.
 *
 * No commitment, no streak. That mirrors a goal's `stalled` status, and it means the
 * feature's empty state is a real instruction rather than a zero.
 */
export function commitment(plannedMonthly: number, goals: Goal[]): { bar: number; barSource: BarSource } {
  if (plannedMonthly > 0) return { bar: plannedMonthly, barSource: "recurring" };
  const planned = goals
    .filter((g) => !g.archived)
    .reduce((a, g) => a + (g.monthly_plan ?? 0), 0);
  if (planned > 0) return { bar: planned, barSource: "goals" };
  return { bar: 0, barSource: "none" };
}

/**
 * What a debt's own schedule already asked of you this month — the part of a repayment
 * that is merely keeping a promise, and so isn't saving.
 *
 * Straight-line to maturity, matching the assumption `lib/goals.ts` projects debts under.
 * A credit line has no term, so its `monthly_payment` is the whole of what's required; with
 * no stated minimum there is nothing to beat and every ₫ counts.
 */
function requiredMonthly(d: ScoredDebt): number {
  if (d.monthly_payment && d.monthly_payment > 0) return d.monthly_payment;
  if (isRevolving(d)) return 0;
  return d.term_months > 0 ? maturityValue(d) / d.term_months : 0;
}

// ---------- the walk ----------

function emptyLevers(): Record<Lever, number> {
  return { invest: 0, deposit: 0, fund: 0, debt: 0 };
}

/**
 * Null when there's nothing to measure — no commitment set, or no money ever recorded.
 * The card renders its own empty state from that rather than showing a streak of zero,
 * which would read as a failure you haven't had the chance to have yet.
 */
export function streak(w: StreakWorld): Streak | null {
  if (!(w.bar > 0)) return null;

  const byMonth = new Map<MonthKey, Record<Lever, number>>();
  const bump = (month: MonthKey, lever: Lever, amount: number) => {
    if (!amount) return;
    const row = byMonth.get(month) ?? emptyLevers();
    row[lever] += amount;
    byMonth.set(month, row);
  };

  for (const [month, amount] of Object.entries(w.investedByMonth)) bump(month, "invest", amount);
  for (const s of w.savings) bump(monthOf(s.start_date), "deposit", s.principal);

  // Fund cash, netted per fund per month and floored at zero. Floored because draining a
  // fund is usually the goal *arriving* — you bought the car — and spending money you
  // deliberately saved for is the plan working, not a lapse. Netted because moving fund
  // cash into a term deposit is one movement recorded twice (a withdrawal here, a new
  // deposit there) and must not read as fresh saving.
  const fundNet = new Map<string, number>();
  for (const c of w.contributions) {
    const key = `${c.goal_id}|${monthOf(c.date)}`;
    fundNet.set(key, (fundNet.get(key) ?? 0) + c.amount);
  }
  for (const [key, net] of fundNet) bump(key.slice(key.indexOf("|") + 1), "fund", Math.max(0, net));

  // Only the part of a repayment that beat the schedule. Counting repayments in full would
  // make the streak say "you paid your mortgage" — true every month, and worth nothing.
  const required = new Map<number, number>();
  for (const d of w.debts) required.set(d.id, requiredMonthly(d));
  const paidPerDebt = new Map<string, number>();
  for (const p of w.payments) {
    const key = `${p.debt_id}|${monthOf(p.date)}`;
    paidPerDebt.set(key, (paidPerDebt.get(key) ?? 0) + p.amount);
  }
  for (const [key, paid] of paidPerDebt) {
    const cut = key.indexOf("|");
    const req = required.get(Number(key.slice(0, cut))) ?? 0;
    bump(key.slice(cut + 1), "debt", Math.max(0, paid - req));
  }

  const keys = [...byMonth.keys()].sort();
  if (keys.length === 0) return null;

  const nowKey = monthOf(w.today);
  const from = monthIndex(keys[0]);
  const to = monthIndex(nowKey);
  // A row dated into the future (a deposit booked ahead) would otherwise run the walk
  // backwards. The current month is always the last one shown.
  if (to < from) return null;

  const totals: number[] = [];
  const levers: Record<Lever, number>[] = [];
  for (let i = from; i <= to; i++) {
    const row = byMonth.get(monthKey(i)) ?? emptyLevers();
    levers.push(row);
    totals.push(LEVERS.reduce((a, l) => a + row[l], 0));
  }

  // The trailing window and its mean. Divided by how many months it actually spans, not by
  // GRACE_WINDOW: at the very start of your history there aren't three months behind you,
  // and counting the months before you tracked anything as zeroes would make your first two
  // months uncarryable by a past that doesn't exist.
  const windowAt = (i: number) => totals.slice(Math.max(0, i - GRACE_WINDOW + 1), i + 1);
  const meanOf = (window: number[]) => window.reduce((a, v) => a + v, 0) / window.length;

  const months: StreakMonth[] = totals.map((total, i) => {
    const month = monthKey(from + i);
    const row = levers[i];
    if (total >= w.bar) return { month, total, levers: row, status: "met" };
    const avg = meanOf(windowAt(i));
    if (avg >= w.bar) return { month, total, levers: row, status: "carried", carriedBy: avg };
    // The grace rule applies to the month in progress too, which is the point of computing
    // it before deciding it's open: a month you're already carrying on the average passes
    // today, and telling you it still needs the full bar would be asking for money the rule
    // doesn't require.
    return { month, total, levers: row, status: month === nowKey ? "open" : "missed" };
  });

  const now = months[months.length - 1];
  // An in-progress month is neither a success nor a break — it's simply not settled, so it
  // leaves the run alone until it either clears the bar or the month ends.
  const settled = now.status === "open" ? months.slice(0, -1) : months;
  const good = settled.map((m) => m.status === "met" || m.status === "carried");

  let current = 0;
  for (let i = good.length - 1; i >= 0 && good[i]; i--) current++;

  let best = 0;
  let run = 0;
  for (const ok of good) {
    run = ok ? run + 1 : 0;
    if (run > best) best = run;
  }

  // The *least* you must still add for this month to count — whichever of the two routes is
  // cheaper: clearing the bar outright, or lifting the trailing average onto it. Quoting the
  // bar alone would name a number the rule never asks for.
  const needed = () => {
    if (now.status !== "open") return 0;
    const last = months.length - 1;
    const window = windowAt(last);
    const byAverage = w.bar * window.length - window.reduce((a, v) => a + v, 0);
    return Math.max(0, Math.min(w.bar - now.total, byAverage));
  };

  return {
    bar: w.bar,
    barSource: w.barSource,
    months,
    current,
    best,
    now,
    shortfall: needed(),
  };
}

/** The last `n` months, oldest → newest, padded at the front if the history is shorter.
 *  The grid wants a fixed number of cells so it doesn't reflow as history accumulates. */
export function recentMonths(s: Streak, n: number): (StreakMonth | null)[] {
  const tail = s.months.slice(-n);
  return [...Array(Math.max(0, n - tail.length)).fill(null), ...tail];
}
