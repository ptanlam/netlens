/**
 * Goal maths: progress toward a target on a metric you already track, and — the whole
 * point of the feature — whether the pace you've *committed* to actually gets you there.
 *
 * Pure (no Node deps), so both the server pages and the client manager can use it.
 *
 * Three deliberate assumptions, all conservative — a goal that says "on track" is on
 * track without needing anything to go right:
 *  - **Market return is 0%.** Investments grow only by money you put in. Any gain is
 *    upside the projection never counted on.
 *  - **Fixed/flexible debts are cleared on schedule**: what's owed declines straight-line
 *    to zero at maturity. Credit lines decline by their `monthly_payment`.
 *  - **Term deposits don't grow by new deposits** — we can't see money you haven't
 *    scheduled. Interest accrues (that part is deterministic); nothing else does.
 */

import {
  currentValue,
  debtOwed,
  isRevolving,
  maturityDate,
  type Accruing,
  type Payment,
} from "./savings";
import { MONTHS } from "./format";
import type { Goal, GoalContribution, GoalMetric } from "./types";

/** Past this we call a goal unreachable rather than print a date in the next century. */
const MAX_HORIZON_MONTHS = 600;
const DAY_MS = 86_400_000;
const AVG_MONTH_MS = 30.44 * DAY_MS;

/** How far back a fund's own contribution history is averaged for its fallback pace. */
const FUND_PACE_WINDOW_MONTHS = 6;

/** The forward walk samples whole months, so sub-month precision is an illusion. Landing
 *  within half a month of the deadline is "on time" — without this, a goal arriving 13
 *  days late reads as "Behind" while the copy rounds it to "right on time". */
const ON_TIME_TOLERANCE_MONTHS = 0.5;

export type GoalDebt = Accruing & {
  id: number;
  kind: string;
  monthly_payment: number | null;
};

/** Everything a projection needs, gathered from the DB by the caller (a server page). */
export interface GoalWorld {
  /** ISO date the projection is anchored to — used for month/deadline arithmetic. */
  today: string;
  /**
   * The same anchor as an instant. Interest accrues by the *second*, so a goal evaluated
   * at midnight would disagree with the net-worth hero (which accrues to `new Date()`) by
   * a fraction of a day's interest — two different numbers for the same figure, one above
   * the other on the dashboard. Passed in rather than read from the clock so a projection
   * stays deterministic given its world.
   */
  nowMs: number;
  /** Portfolio value today (`payload.portfolioTotal`). */
  investments: number;
  savings: Accruing[];
  debts: GoalDebt[];
  paymentsByDebt: Record<number, Payment[]>;
  /** Every sinking fund — archived ones too, since the cash in them is still yours and
   *  still belongs in net worth. */
  funds: FundRef[];
  /** Each fund's cash ledger, keyed by goal id. */
  contributions: Record<number, GoalContribution[]>;
  /** Deposits earmarked for a fund, keyed by goal id. They keep their own rate and term,
   *  and stay part of `savings` — a deposit belongs to a goal, it doesn't leave savings. */
  savingsByGoal: Record<number, Accruing[]>;
  /** ₫/month you've committed to, from active recurring rules. */
  plannedMonthly: number;
  /** ₫/month you've actually contributed over the trailing window. */
  actualMonthly: number;
}

export interface FundRef {
  id: number;
}

/** What `valueAt` needs to know about the thing being projected. A whole `Goal` satisfies
 *  it; a bare `{ metric }` is enough for the metrics that carry no per-goal state. */
export type GoalLike = { metric: GoalMetric; id?: number };

/** Where the projected pace came from — the UI says which, so the number is never a
 *  black box. `schedule` means the debt's own amortization is doing the work. */
export type PaceSource = "goal" | "planned" | "actual" | "schedule" | "none";

export type GoalStatus = "hit" | "on_track" | "behind" | "open" | "stalled";

export interface GoalProjection {
  /** The metric's value today. */
  current: number;
  /** 0…1, measured from `baseline` so a payoff bar starts empty. */
  progress: number;
  /** Still to cover, in the direction of the target (0 once hit). */
  remaining: number;
  pace: number;
  paceSource: PaceSource;
  /** Months until `target_date` (null when the goal has no deadline). */
  monthsLeft: number | null;
  /** ₫/month needed to land exactly on `target_date` (null if hit or no deadline). */
  requiredPerMonth: number | null;
  /** True when `requiredPerMonth` is money needed *on top of* a debt's own repayment
   *  schedule, rather than a total pace to aim for. The two aren't comparable, so the UI
   *  has to word them differently. */
  requiredIsExtra: boolean;
  /** ISO date you arrive at the current pace — null if you never do. */
  projectedDate: string | null;
  /** Projected minus target date, in months. Positive = late. */
  driftMonths: number | null;
  status: GoalStatus;
}

/** A goal counts up toward its target — except debts, which count down to it. */
export function isUpward(metric: GoalMetric): boolean {
  return metric !== "debts";
}

/** Fractional months from one ISO date to another. Negative if `to` is in the past. */
export function monthsBetween(from: string, to: string): number {
  const [ya, ma, da] = from.split("-").map(Number);
  const [yb, mb, db] = to.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma) + (db - da) / 30.44;
}

function dateAfter(w: GoalWorld, months: number): Date {
  return new Date(w.nowMs + months * AVG_MONTH_MS);
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Midnight of `d`'s LOCAL day, as the same UTC-midnight basis the ledger's dates parse to
 *  (rows store a local ISO date). Using UTC here instead would push "today" forward by the
 *  timezone offset, so money added late in the evening wouldn't appear until morning. */
function startOfDayMs(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Total term-deposit value `months` from now: interest only, no new deposits. */
function savingsAt(w: GoalWorld, months: number): number {
  const at = dateAfter(w, months);
  return w.savings.reduce((a, s) => a + currentValue(s, at), 0);
}

/**
 * What a debt will still owe `months` from now, assuming you keep to its schedule.
 *
 * `debtOwed` can't be asked this directly: at a future date it accrues interest but
 * subtracts only the payments already *recorded*, so it would project every debt as
 * growing forever. We model the repayments instead.
 */
function projectedOwed(w: GoalWorld, d: GoalDebt, months: number): number {
  const owedNow = debtOwed(d, w.paymentsByDebt[d.id] ?? [], new Date(w.nowMs));
  if (owedNow <= 0) return 0;

  // A credit line is a snapshot balance, not a curve — it shrinks by what you pay it.
  if (d.kind === "credit" || isRevolving(d)) {
    const monthly = d.monthly_payment ?? 0;
    return Math.max(0, owedNow - monthly * months);
  }

  // Fixed / flexible: assume it's cleared by maturity, declining straight-line.
  const monthsLeft = monthsBetween(w.today, maturityDate(d));
  if (monthsLeft <= 0) return owedNow; // already past maturity — whatever's left, stays
  return owedNow * Math.max(0, (monthsLeft - months) / monthsLeft);
}

/**
 * Total owed `months` from now, under one of two models:
 *  - **schedule** (`usePlan = false`): each debt follows its own repayment path.
 *  - **plan** (`usePlan = true`): you've told the goal what you'll pay each month, and
 *    that *replaces* the schedule — otherwise the two would be counted twice over.
 */
function debtsAt(w: GoalWorld, months: number, monthlyPayment: number, usePlan: boolean): number {
  if (usePlan) {
    const owedNow = w.debts.reduce((a, d) => a + projectedOwed(w, d, 0), 0);
    return Math.max(0, owedNow - monthlyPayment * months);
  }
  return w.debts.reduce((a, d) => a + projectedOwed(w, d, months), 0);
}

/**
 * The *cash* a fund holds at `at` — its ledger, summed up to that date. Cash set aside
 * earns nothing: interest comes from the deposits earmarked to the fund, each with its own
 * rate and term (`Saving.goal_id`), because you take whatever rate was on offer the month
 * you had the money — a single fund-wide rate could never say that.
 *
 * Evaluated at the START of `at`'s day: the ledger only knows dates, so a row dated today
 * counts today, and the balance you're shown is exactly the one a withdrawal settles
 * against — no "Mark as bought" quoting one figure and writing another.
 */
export function fundCashAt(rows: GoalContribution[], at: Date): number {
  const atMs = startOfDayMs(at);
  return rows.reduce(
    (a, c) => (Date.parse(c.date + "T00:00:00Z") <= atMs ? a + c.amount : a),
    0,
  );
}

/** What one sinking fund is worth `months` from now: cash set aside, plus the deposits
 *  earmarked to it, each accruing on its own terms. No new money is assumed. */
function fundAt(w: GoalWorld, g: GoalLike, months: number): number {
  if (g.id == null) return 0; // an unsaved fund has no ledger yet
  const at = dateAfter(w, months);
  const cash = fundCashAt(w.contributions[g.id] ?? [], at);
  const deposits = (w.savingsByGoal[g.id] ?? []).reduce((a, s) => a + currentValue(s, at), 0);
  return cash + deposits;
}

/** Everything earmarked for a sinking fund, `months` from now: cash pots plus the deposits
 *  linked to them. This money is spoken for, which is why a net-worth goal leaves it out. */
function earmarkedAt(w: GoalWorld, months: number): number {
  const at = dateAfter(w, months);
  const cash = w.funds.reduce((a, f) => a + fundCashAt(w.contributions[f.id] ?? [], at), 0);
  const deposits = Object.values(w.savingsByGoal)
    .flat()
    .reduce((a, s) => a + currentValue(s, at), 0);
  return cash + deposits;
}

/** What one fund is worth today. */
export function fundValue(w: GoalWorld, g: GoalLike): number {
  return fundAt(w, g, 0);
}

/**
 * The goal's metric, `months` from now, assuming `pace` ₫/month goes toward it.
 *
 * Takes the goal rather than just its metric because a fund's value lives in its own
 * ledger — every other metric is a figure the whole world shares.
 *
 * `paceRepaysDebt` says the pace is money aimed at the debt itself (a debt goal with a
 * monthly plan). It must be threaded through rather than inferred from `pace > 0`,
 * because the required-per-month figure is derived by evaluating this at `pace = 0` —
 * and that has to stay on the *same* model, or it silently answers a different question.
 */
export function valueAt(
  w: GoalWorld,
  g: GoalLike,
  months: number,
  pace: number,
  paceRepaysDebt = false,
): number {
  switch (g.metric) {
    case "investments":
      return w.investments + pace * months;
    case "savings":
      return savingsAt(w, months) + pace * months;
    case "debts":
      return debtsAt(w, months, pace, paceRepaysDebt);
    case "fund":
      // Future contributions are counted as cash: money you haven't set aside yet can't
      // be earning interest, which keeps the projection on the conservative side.
      return fundAt(w, g, months) + pace * months;
    case "net_worth":
      // Contributions land in investments; debts follow their own schedule.
      //
      // Money earmarked for a sinking fund is deliberately NOT here — neither the cash pot
      // nor the deposits linked to it. It counts in your net worth on the dashboard (you
      // do hold it), but a net-worth *goal* asks a different question: how far you've got
      // toward a number that's yours to keep. Money already promised to a car isn't, and
      // counting it would let a goal look reached on the strength of savings that are about
      // to walk out the door.
      return (
        w.investments +
        pace * months +
        savingsAt(w, months) -
        earmarkedAt(w, months) -
        debtsAt(w, months, 0, false)
      );
  }
}

/**
 * The pace to project at, in priority order:
 *  1. what you told the goal you'd put in (`monthly_plan`) — always wins;
 *  2. your active recurring rules — money you've actually committed;
 *  3. your recent real contributions — what you've been doing lately.
 *
 * Debts default to their own repayment schedule, and term deposits to nothing at all,
 * because contributions from recurring rules flow into investments, not into either.
 */
export function resolvePace(g: Goal, w: GoalWorld): { pace: number; paceSource: PaceSource } {
  if (g.monthly_plan != null && g.monthly_plan > 0)
    return { pace: g.monthly_plan, paceSource: "goal" };
  if (g.metric === "debts") return { pace: 0, paceSource: "schedule" };
  if (g.metric === "savings") return { pace: 0, paceSource: "none" };
  if (g.metric === "fund") {
    // A fund is fed by hand, so the global rules say nothing about it — but its own
    // ledger does. Withdrawals are excluded: taking money out isn't a slower pace, it's
    // a different act, and averaging it in would quietly project the pot shrinking.
    const rate = fundContributionRate(w, g);
    return rate > 0 ? { pace: rate, paceSource: "actual" } : { pace: 0, paceSource: "none" };
  }
  if (w.plannedMonthly > 0) return { pace: w.plannedMonthly, paceSource: "planned" };
  if (w.actualMonthly > 0) return { pace: w.actualMonthly, paceSource: "actual" };
  return { pace: 0, paceSource: "none" };
}

/** ₫/month put into this fund over the trailing window — cash you set aside plus deposits
 *  you opened for it. Both are you feeding the fund; only the vehicle differs. */
function fundContributionRate(w: GoalWorld, g: Goal): number {
  const recent = (date: string) => monthsBetween(date, w.today) <= FUND_PACE_WINDOW_MONTHS;
  const cash = (w.contributions[g.id] ?? [])
    .filter((c) => c.amount > 0 && recent(c.date))
    .reduce((a, c) => a + c.amount, 0);
  const deposited = (w.savingsByGoal[g.id] ?? [])
    .filter((s) => recent(s.start_date))
    .reduce((a, s) => a + s.principal, 0);
  return (cash + deposited) / FUND_PACE_WINDOW_MONTHS;
}

function hasReached(g: Goal, value: number): boolean {
  return isUpward(g.metric) ? value >= g.target : value <= g.target;
}

/** Fraction of the journey covered, measured from `baseline` (0…1). */
export function progressOf(g: Goal, current: number): number {
  const span = isUpward(g.metric) ? g.target - g.baseline : g.baseline - g.target;
  if (span <= 0) return hasReached(g, current) ? 1 : 0; // degenerate target
  const done = isUpward(g.metric) ? current - g.baseline : g.baseline - current;
  return Math.min(1, Math.max(0, done / span));
}

export function project(g: Goal, w: GoalWorld): GoalProjection {
  const { pace, paceSource } = resolvePace(g, w);
  // A monthly plan on a *debt* goal is money aimed at the debt, so it stands in for the
  // repayment schedule. Anywhere else the pace is a contribution.
  const repaysDebt = g.metric === "debts" && paceSource === "goal";
  const current = valueAt(w, g, 0, pace, repaysDebt);
  const hit = hasReached(g, current);

  const monthsLeftRaw = g.target_date ? monthsBetween(w.today, g.target_date) : null;
  const monthsLeft = monthsLeftRaw == null ? null : Math.max(0, monthsLeftRaw);

  // Linear in pace, so the pace that lands exactly on the target date solves directly:
  // whatever the metric drifts to on its own by then is credited first. For a debt on its
  // own schedule that drift IS the schedule, so the answer is what you'd need *on top* of
  // it — which is why `requiredIsExtra` exists rather than the UI guessing.
  let requiredPerMonth: number | null = null;
  if (!hit && monthsLeft != null && monthsLeft > 0) {
    const drifted = valueAt(w, g, monthsLeft, 0, repaysDebt);
    const gap = isUpward(g.metric) ? g.target - drifted : drifted - g.target;
    requiredPerMonth = Math.max(0, gap / monthsLeft);
  }

  // Walk forward a month at a time until the target is met. Cheap (a handful of rows),
  // and it copes with the non-linear bits — compounding interest, a debt hitting zero.
  let projectedDate: string | null = null;
  if (hit) {
    projectedDate = w.today;
  } else {
    for (let m = 1; m <= MAX_HORIZON_MONTHS; m++) {
      if (hasReached(g, valueAt(w, g, m, pace, repaysDebt))) {
        projectedDate = isoOf(dateAfter(w, m));
        break;
      }
    }
  }

  const driftMonths =
    projectedDate && g.target_date ? monthsBetween(g.target_date, projectedDate) : null;

  let status: GoalStatus;
  if (hit) status = "hit";
  else if (!projectedDate) status = "stalled"; // no pace, or a pace that never arrives
  else if (!g.target_date) status = "open";
  else status = (driftMonths ?? 0) <= ON_TIME_TOLERANCE_MONTHS ? "on_track" : "behind";

  const remaining = hit
    ? 0
    : isUpward(g.metric)
      ? g.target - current
      : current - g.target;

  return {
    current,
    progress: progressOf(g, current),
    remaining,
    pace,
    paceSource,
    monthsLeft,
    requiredPerMonth,
    requiredIsExtra: paceSource === "schedule",
    projectedDate,
    driftMonths,
    status,
  };
}

/** A goal plus its projection — what the pages hand to the UI. */
export interface GoalView {
  goal: Goal;
  proj: GoalProjection;
}

// ---------- display copy (kept here so both surfaces word it identically) ----------

export const STATUS_LABELS: Record<GoalStatus, string> = {
  hit: "Reached",
  on_track: "On track",
  behind: "Behind",
  open: "No deadline",
  stalled: "No pace",
};

/** "2028-02-14" → "Feb 2028". */
export function monthYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** Whole months, rounded — "2 months late" reads better than "1.7 months late". */
export function roundMonths(m: number): number {
  return Math.round(Math.abs(m));
}

/** The one-line answer: when you arrive, and how that compares to the deadline. */
export function verdict(g: Goal, p: GoalProjection): string {
  if (p.status === "hit") return "Target reached";
  if (p.status === "stalled")
    return p.paceSource === "none"
      ? "No pace yet — set a monthly plan"
      : "Not reachable at this pace";
  const eta = p.projectedDate ? monthYear(p.projectedDate) : "—";
  if (p.status === "open") return `On pace for ${eta}`;
  const drift = roundMonths(p.driftMonths ?? 0);
  if (drift === 0) return `Arriving ${eta} — right on time`;
  const late = (p.driftMonths ?? 0) > 0;
  return `Arriving ${eta} — ${drift} month${drift === 1 ? "" : "s"} ${late ? "late" : "early"}`;
}

/** How much more per month than the current pace it takes to land on the deadline.
 *  Meaningless when the required figure is already an "extra" (see `requiredIsExtra`). */
export function shortfall(p: GoalProjection): number {
  if (p.requiredPerMonth == null || p.requiredIsExtra) return 0;
  return Math.max(0, p.requiredPerMonth - p.pace);
}
