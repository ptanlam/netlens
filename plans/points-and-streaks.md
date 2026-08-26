# Points & streaks

A behaviour layer over money that already moved. Nothing new to type, nothing new stored.

## The trap this design exists to avoid

Every gamified finance app rewards **using the app**: log in, log a transaction, check in
daily. That is worthless here and actively dangerous, because in this app *you enter your
own data*. A point awarded for logging a transaction is farmable in one keystroke, and — the
real problem — it gives you a reason to log something that didn't happen, or to leave a
mistake uncorrected because fixing it would cost you a streak. The whole value of this app
is that the numbers are true. A game that competes with that is a bug.

So, one rule, and everything below follows from it:

> **Points come from money that moved, never from app usage.** No streak for opening the
> app, no points for logging, no daily check-in.

Second rule, inherited from the rest of the codebase (subscriptions derive forward charges,
goals derive projections, nothing about a future charge is stored):

> **Nothing is stored.** No `points` column, no `streak_count`. Both are derived from dated
> rows on every request, so editing a transaction from March correctly rewrites the score.
> A stored counter is a counter you'd protect by lying.

Third, the same carve-out subscriptions get:

> **Points never touch net worth.** They are commentary on behaviour, not a thing you own.

## The streak: a month, not a day

The unit is a **calendar month**. Money in this app moves monthly — salary, deposits,
subscription renewals, debt payments. A daily streak would punish you for an ordinary
Tuesday on which nothing was supposed to happen, and it would train the wrong reflex.

A month **counts** when your net contribution that month clears your commitment:

- **net contribution** = buys − sells in `transactions`, + new `savings` principal,
  + positive `goal_contributions`, + `debt_payments` beyond what the schedule required.
- **commitment** = `plannedMonthly` (already computed in `GoalWorld` from active recurring
  rules), or a floor set in `meta` if there are no rules.

Note what is *excluded*: market movement. A bull market must not hand you a streak, and a
crash must not break one. This is exactly the goals lib's existing "market return is 0%"
assumption — the streak measures the part you control.

**Grace.** A month that falls short but whose trailing 3-month average still clears the bar
does not break the streak; it's marked *carried* rather than *met*. A bonus paid in March
that covers April is still saving, and an honest lumpy income shouldn't read as failure.

**Never show a countdown.** No "your 14-month streak dies in 3 days". That is loss aversion
pointed at a financial decision, and the decision it produces is a bad one. Show the
shortfall as a plain number instead — "₫2.1M more this month keeps it" — which is the same
information and is, usefully, just a savings target.

## Points: four levers, one per page

Points must measure *improvement to the balance sheet*, not volume — otherwise a rich month
scores high and points are just net worth wearing a hat. Each lever maps to a page that
already exists:

| Lever | Source | Awarded on |
|---|---|---|
| **Contribute** | `transactions`, `savings` | net money in, above the plan |
| **Deleverage** | `debt_payments` vs. `debtOwed()` amortization | principal killed *ahead of* schedule |
| **Earn** | `savings` | interest accrued — money that worked while you didn't |
| **Prune** | `subscriptions.cancelled_date` | 12 × the plan's ₫/month, once |

Prune is the best of the four and the reason this feature is worth building: cancelling a
₫250k/month subscription is worth ₫3M a year forever, it feels like nothing, and no screen
in the app currently congratulates you for it. `lib/subscriptions.ts` already hands you the
₫/month.

**Scale.** `points = ₫improvement / UNIT`, `UNIT` in `meta` (default ₫100,000), with a
streak multiplier. Deliberately boring arithmetic: any number on screen has to be one you
can re-derive in your head, the same standard `PaceSource` holds itself to. Cap the monthly
award so one windfall doesn't print a year's worth.

## Shape

- `lib/score.ts` — pure, over a world shape like `GoalWorld`. All the maths.
- **Zero migrations** for v1. Settings live in `meta` via `lib/settings.ts`; everything else
  is derived. Badges, if they ever happen, are derived too ("first month over ₫10M" is a
  query, not a row).
- `components/streak-card.tsx` on the dashboard, beside net worth.
- A 12-month met/carried/missed grid — `components/pnl-calendar.tsx` is the pattern to copy.
- **No new nav item.** A seven-item nav shouldn't spend a slot on a game. It lives on the
  dashboard and in a section on Goals, where the commitment already is.

## Phasing

1. **Streak only** — *shipped*. `lib/score.ts`, `components/streak-card.tsx`, one aggregate
   query (`db.investedByMonth`), no migration. Live with it a month — if the monthly bar is
   set wrong, that's the thing you want to find out cheaply.
2. **Points and the four levers.** Once the streak's definition of "a month that counts"
   has survived contact.
3. **Milestones**, if they still sound appealing by then. They usually don't.
