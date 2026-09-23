/**
 * Where the decisions you've already made leave you.
 *
 * Pure (no Node deps), like `lib/goals.ts` and `lib/score.ts`, and — same as the streak —
 * **nothing here is stored**: no table, no migration, no cached projection. Every figure is
 * re-derived from dated rows on each request, so correcting last March's deposit correctly
 * rewrites the future too.
 *
 * The app already projects forward in one place: a goal asks whether *one* number arrives on
 * time. This asks the plainer question the dashboard never answers — what does net worth do
 * from here, given the deposits, loans and rules already in place. It reuses that machinery
 * rather than restating it (`projectedOwed`, `fundCashAt`, `currentValue`), because two
 * models of when a loan clears would eventually disagree on two screens.
 *
 * Three assumptions, all inherited from `lib/goals.ts` and all deliberately conservative:
 *
 *  - **Market return is 0%.** Investments grow only by money you add. This is the assumption
 *    that keeps the whole feature honest: the line is a *floor*, not a bet, and a bull market
 *    can no more draw you a nicer future than it can hand you a streak (`lib/score.ts`).
 *  - **Deposits accrue and debts amortise on their own terms** — the contracted half, which
 *    happens whether or not you do anything.
 *  - **Money you add lands somewhere you own.** Which pocket it goes in doesn't change the
 *    total, so the pace is added to the net figure rather than to a particular line.
 *
 * So each month has two heights: `floor`, what you'd hold having added nothing more from
 * today, and `net`, the floor plus the pace you've committed to. The gap between them is the
 * part that depends on you, and drawing it as a gap rather than as one line is the point —
 * it separates what is contracted from what is merely intended.
 */

import { currentValue, isRevolving, maturityDate, maturityValue, addMonths } from "./savings";
import { fundCashAt, projectedOwed, targetVnd, type GoalWorld } from "./goals";
import { chargesBetween } from "./subscriptions";
import { commitment, type BarSource } from "./score";
import type { Debt, Goal, Saving, Subscription } from "./types";

/** The furthest out the page will project. Past about five years the contracted half has run
 *  out (every deposit matured, every loan cleared) and the line is mostly the pace
 *  extrapolated — arithmetic rather than a forecast, which the long horizons are read as. */
export const MAX_HORIZON_MONTHS = 240;

export interface ForecastPoint {
  /** Whole months from today. 0 is today, and its `net` is the dashboard's net worth. */
  i: number;
  /** ISO date of this step. */
  date: string;
  /** `YYYY-MM`, for the axis. */
  month: string;
  /** Today's portfolio, unchanged — zero return, so it only moves by what you add. */
  investments: number;
  /** Every term deposit at its own rate and term. Interest stops at maturity. */
  savings: number;
  /** Cash set aside in sinking funds. It earns nothing, so it sits flat. */
  fundCash: number;
  /** Still owed, as a positive number. */
  debts: number;
  /** What the pace has added by this month, at no return — `pace × i`. */
  contributed: number;
  /** What you'd hold having added nothing from today — the contracted line. */
  floor: number;
  /** `floor + contributed`. */
  net: number;
}

/**
 * The pace to project at, and where it came from.
 *
 * The same bar the streak judges you against (`commitment` in `lib/score.ts`) — your
 * recurring rules, else your goals' monthly plans, else none. Reused rather than restated so
 * the number the dashboard says you must clear each month is the same number this page
 * assumes you will: a forecast built on a pace the streak doesn't recognise would be quietly
 * grading you against two different commitments.
 *
 * Debt goals are dropped first. Repaying a loan moves money from one side of net worth to
 * the other and leaves the total where it was, so counting a repayment plan as a pace would
 * grow the line by money that isn't new. It is the same reason the streak doesn't count
 * repayments as a lever.
 */
export function forecastPace(w: GoalWorld, goals: Goal[]): { pace: number; source: BarSource } {
  const { bar, barSource } = commitment(
    w.plannedMonthly,
    goals.filter((g) => g.metric !== "debts"),
  );
  return { pace: bar, source: barSource };
}

/**
 * The instant `iso` falls on, carrying `nowMs`'s time of day forward by whole calendar days.
 *
 * Not `nowMs + months × 30.44 days`: the axis is calendar months, and an average month drifts
 * off them. Anchoring on `nowMs` rather than on midnight is what makes month 0 value at
 * exactly the instant the dashboard does — interest accrues by the second, and a projection
 * whose first point disagreed with the hero above it by a day's interest would look like a
 * bug in whichever of the two you read second.
 */
function instantAt(w: GoalWorld, iso: string): Date {
  return new Date(
    w.nowMs + (Date.parse(iso + "T00:00:00Z") - Date.parse(w.today + "T00:00:00Z")),
  );
}

/** The net-worth walk, one point per calendar month including today's. */
export function forecast(w: GoalWorld, pace: number, months: number): ForecastPoint[] {
  const out: ForecastPoint[] = [];
  for (let i = 0; i <= months; i += 1) {
    const date = addMonths(w.today, i);
    const at = instantAt(w, date);
    const savings = w.savings.reduce((a, s) => a + currentValue(s, at), 0);
    // Every fund, archived included — the same reading `db.fundsCashTotal` takes, and the
    // reason net worth on the dashboard counts money in a fund you've put away.
    const fundCash = w.funds.reduce((a, f) => a + fundCashAt(w.contributions[f.id] ?? [], at), 0);
    const debts = w.debts.reduce((a, d) => a + projectedOwed(w, d, i), 0);
    const contributed = pace * i;
    const floor = w.investments + savings + fundCash - debts;
    out.push({
      i,
      date,
      month: date.slice(0, 7),
      investments: w.investments,
      savings,
      fundCash,
      debts,
      contributed,
      floor,
      net: floor + contributed,
    });
  }
  return out;
}

/** A point with an assumed market return laid on top of it. */
export interface GrownPoint extends ForecastPoint {
  /** The assumed return, and *only* that — zero at 0%/yr. Kept as its own figure rather
   *  than folded into the others so every screen can show how much of the number is a
   *  guess. */
  growth: number;
  /** `net + growth`. */
  grown: number;
}

/**
 * Lay an assumed annual return on the walk.
 *
 * **This is the one number in the app nobody can check**, and the whole design of the knob
 * follows from that:
 *
 *  - **It defaults to 0% and is set by hand.** Nothing here picks a rate for you. A default
 *    of 7% would be a house view dressed up as arithmetic, and every figure downstream would
 *    inherit it without ever having been agreed to.
 *  - **It never touches `floor` or `net`.** Those keep their meaning exactly — what's
 *    contracted, and what's contracted plus money you've committed to adding, both at zero
 *    return. The assumption lives entirely in `growth`, so a chart can draw it as a separate
 *    band and a reader can always subtract it back out by eye.
 *  - **It applies only to investments.** Deposits have their own contractual rates and debts
 *    their own schedules; compounding a *second* rate over either would be inventing a return
 *    on money whose return is already known.
 *  - **It runs negative.** A forecast that only ever bends upward is a sales pitch. The same
 *    arithmetic at −5% is the more useful half of the question.
 *
 * Two things compound: what you already hold, from today, and each contribution from the
 * month it lands (an ordinary annuity — money arrives at month end and earns nothing in the
 * month it arrives). Monthly compounding, matching `accrue` in `lib/savings.ts`, so a rate
 * means the same thing on this page as it does on a deposit.
 */
export function applyGrowth(
  points: ForecastPoint[],
  pace: number,
  ratePct: number,
): GrownPoint[] {
  const m = ratePct / 100 / 12;
  return points.map((p) => {
    if (m === 0) return { ...p, growth: 0, grown: p.net };
    const factor = Math.pow(1 + m, p.i);
    // Future value of what you hold, plus the future value of the contributions — each net
    // of the money itself, since `net` already counts every dong you put in.
    const growth = p.investments * (factor - 1) + (pace * ((factor - 1) / m) - p.contributed);
    return { ...p, growth, grown: p.net + growth };
  });
}

/** What kind of thing is happening on a date — the four reasons the line changes shape. */
export type ForecastEventKind = "maturity" | "payoff" | "goal" | "renewal";

export interface ForecastEvent {
  date: string;
  kind: ForecastEventKind;
  /** The thing it happens to — the bank, the lender, the plan, the goal. Just the noun: the
   *  verb belongs to `kind`, and carrying it here too gave every row a stutter ("Topi
   *  matures · Deposit matures"). */
  label: string;
  /** The money involved: what a deposit pays out, what a renewal charges, what a target is. */
  amount: number | null;
  /** True when the amount doesn't move net worth — a subscription charge is a rate of spend,
   *  not a thing you own or owe, and it stays out of the line for the same reason it stays
   *  out of the dashboard's total. It's listed because it still lands in that month. */
  outside: boolean;
}

export interface EventInput {
  world: GoalWorld;
  /** The deposit rows themselves. `GoalWorld.savings` is only the accruing shape, and an
   *  event needs the bank's name to be worth reading. */
  deposits: Saving[];
  debts: Debt[];
  goals: Goal[];
  subscriptions: Subscription[];
  months: number;
}

/**
 * The dated events inside the horizon — the things that make the line kink.
 *
 * A projection nobody can interrogate is a decoration. Every step in the curve has a cause
 * with a date on it, and this is that list: the deposit that matures, the loan that clears,
 * the target you set, the annual charge you forgot about.
 */
export function forecastEvents({
  world,
  deposits,
  debts,
  goals,
  subscriptions,
  months,
}: EventInput): ForecastEvent[] {
  const today = world.today;
  const horizon = addMonths(today, months);
  const inWindow = (d: string) => d > today && d <= horizon;
  const out: ForecastEvent[] = [];

  for (const s of deposits) {
    if (s.term_months <= 0) continue; // open-ended: never matures
    const on = maturityDate(s);
    if (!inWindow(on)) continue;
    out.push({
      date: on,
      kind: "maturity",
      label: s.bank ?? "Deposit",
      // What the bank hands back, not what it's worth today — the figure you'd be deciding
      // what to do with on the day.
      amount: maturityValue(s),
      outside: false,
    });
  }

  for (const d of debts) {
    const owed = projectedOwed(world, d, 0);
    if (owed <= 0) continue;
    if (d.kind === "credit" || isRevolving(d)) {
      // A credit line has no maturity — it clears when the payments have eaten the balance,
      // so the date is derived from the payment rather than read off the contract.
      const monthly = d.monthly_payment ?? 0;
      if (monthly <= 0) continue; // nothing scheduled: it never clears on its own
      const on = addMonths(today, Math.ceil(owed / monthly));
      if (!inWindow(on)) continue;
      out.push({
        date: on,
        kind: "payoff",
        label: d.lender ?? "Credit line",
        amount: owed,
        outside: false,
      });
    } else {
      const on = maturityDate(d);
      if (!inWindow(on)) continue;
      out.push({
        date: on,
        kind: "payoff",
        label: d.lender ?? "Loan",
        amount: owed,
        outside: false,
      });
    }
  }

  for (const g of goals) {
    if (g.archived || !g.target_date || !inWindow(g.target_date)) continue;
    out.push({
      date: g.target_date,
      kind: "goal",
      // The live conversion, never the stored column — see `GoalProjection.target`.
      label: g.name,
      amount: targetVnd(g, world),
      outside: false,
    });
  }

  // Yearly plans only. The lump is the whole reason a renewal is worth a row: a monthly
  // charge is already inside the ₫/month you know about, while a year's price landing in one
  // month is exactly the thing a rate-of-spend figure hides (see `lib/subscriptions.ts`).
  for (const s of subscriptions) {
    if (s.cycle !== "yearly" || s.cancelled_date != null) continue;
    for (const on of chargesBetween(s, addMonths(today, 0), horizon)) {
      if (!inWindow(on)) continue;
      out.push({
        date: on,
        kind: "renewal",
        label: s.name,
        amount: s.amount,
        outside: true,
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}
