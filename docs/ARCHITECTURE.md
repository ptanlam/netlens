# Architecture

A single-user net-worth tracker. The **SQLite database is the source of truth**; the
UI is a thin layer over it. No external state, no API layer beyond a couple of route
handlers.

## Data flow

```
Cloudflare D1 (binding `DB`; schema in migrations/)
        │  lib/db.ts  — pure CRUD, ALL ASYNC (server-only; reads the D1 binding)
        ▼
app/actions.ts  — "use server" mutations; validate → db.* → revalidateAll()
        ▲                                   │
        │ form action                       │ revalidatePath("/", "/transactions", …)
components/*-manager.tsx ("use client")     ▼
        │ renders                     app/**/page.tsx (server component)
        │                             reads db.* → passes plain data to the client manager
        └──────────────── <Dialog>, <Form>, sonner toasts
```

Pure, dependency-free logic (safe to import from client components) lives in
`lib/` files that do **not** touch the database: `types.ts`, `format.ts`,
`savings.ts`, `subscriptions.ts`, `utils.ts`. Anything touching D1 (i.e. `lib/db.ts`,
`lib/prices.ts`, `lib/pnl.ts`) is server-only.

## Directory map

| Path | Role |
|------|------|
| `lib/db.ts` | All SQL, every function `async`. Schema lives in `migrations/`. Money stored as integer VND. |
| `lib/types.ts` | Shared interfaces + `as const` arrays (`ASSET_TYPES`, `INTEREST_TYPES`, `PRICE_SOURCES`). Client-safe. |
| `lib/savings.ts` | Interest maths over the `Accruing` shape — used by BOTH savings and debts. |
| `lib/subscriptions.ts` | Billing-cycle maths over the `Billable` shape — renewal dates, ₫/month, the 12-month forecast. |
| `lib/goals.ts` | Goal progress + the forward projection. Pure; reads a `GoalWorld` gathered by `db.buildGoalWorld()`. |
| `lib/settings.ts` | `SETTINGS_SECTIONS` — the settings rail, shared server/client. |
| `lib/pnl.ts` | Reconstructs the daily P&L series from transactions + `price_history`. |
| `lib/prices.ts` | Live/historical price fetching (CoinGecko, Yahoo, fmarket, VCBF). Never throws; collects errors. |
| `lib/format.ts` | `fmtVND` (₫ with `.` thousands), `fmtMil` (axis short form: `40mil`), `MONTHS`. |
| `app/actions.ts` | Every mutation (transactions, holdings, recurring, savings, debts, subscriptions, goals). |
| `app/**/page.tsx` | One server component per route. |
| `components/ui/*` | Base UI primitives wrapped shadcn-style. Don't reinvent — reuse these. |
| `components/*-manager.tsx` | Client CRUD UIs (recurring, savings, debts, subscriptions, goals). |
| `components/dashboard-charts.tsx` | The dashboard's date-range picker + all charts. |
| `components/net-worth.tsx` | Net worth = investments + savings − debts panel. |
| `components/nav.tsx` | `LINKS` array → desktop nav + mobile side-drawer. |
| `custom-worker.ts` | Worker entrypoint: hands every request to the Next.js app, and runs the price cron. No auth of its own. |

## Authentication

There is none in the app — no login route, no session, no cookie. **Cloudflare Access**
guards `netlens.lamphan.com` and never forwards an unauthenticated request, so by the time
a request reaches the Worker it is already someone you let in. The nav's "Sign out" is a
plain link to `/cdn-cgi/access/logout`, answered by the edge.

The load-bearing part is in `wrangler.jsonc`, not in any code: `workers_dev: false` and
`preview_urls: false`. Access can only protect a hostname on a zone, so a live
`*.workers.dev` URL would be an unauthenticated path to the same Worker and the same D1.

## Routes

Pages: `/` (dashboard), `/transactions`, `/holdings`, `/savings`, `/debts`,
`/subscriptions`, `/goals`,
`/recurring`, `/settings/appearance`, `/settings/price-sources`.
Route handlers: `GET /export.csv`, `GET /api/pnl-history`, `GET /healthz`.
(There is **no** `/add` page — adding a transaction is a `<Dialog>` on `/transactions`.)

**Settings** is a shell (`app/settings/layout.tsx` + `components/settings-nav.tsx`) around
one section per folder. To add a section: a folder under `app/settings/` and an entry in
`SETTINGS_SECTIONS` (`lib/settings.ts` — it's shared by the client rail and the server
redirect at `/settings`, so it can't live in either). `/sources` 308s to
`/settings/price-sources` (see `next.config.ts`).

## The dashboard (`app/page.tsx` + `components/dashboard-charts.tsx`)

- **Net worth panel** (top): investments (`payload.portfolioTotal`) + savings
  (`summarize(listSavings()).currentValue`) − debts (Σ `currentValue(debt)`).
- **KPI cards**: portfolio value, total invested, unrealized P&L, live-prices/refresh.
- **`DashboardCharts`** owns a **date-range control** (preset `<Select>` — Year to
  date [default], This year, Last 12 months, All time, Custom — plus From/To date
  inputs). It drives three year-scoped views computed client-side from
  `payload.contributions` (raw `{date, asset_type, amount}[]`):
  summary cards (Total / Monthly avg / Best month), Invested-per-month (stacked),
  Cumulative invested, and it passes `from`/`to` to `<PnlChart>`.
- **Current portfolio** section (below the divider): allocation donut, holdings bars,
  P&L-by-holding — a *live snapshot*, independent of the selected date range.

## Data model (tables in `migrations/0001_init.sql`)

`transactions`, `instruments`, `recurring_rules`, `price_history`, `meta`,
`savings`, `debts`, `debt_payments`, `goals`, plus `subscriptions` (`0006_*`).
All use `CREATE TABLE IF NOT EXISTS`, so **adding a
new table is the entire migration** — no migration framework. Altering an existing
table's columns would need an explicit `ALTER TABLE` (there is no migration runner), so
prefer additive changes or sentinel values (e.g. debts use `term_months <= 0` to mean
"revolving" rather than making the column nullable).

## Savings & debts interest model

`Accruing = { principal, rate, start_date, term_months, interest_type }`.
- `interest_type`: `"simple"` (interest once over the term) or `"compound"` (monthly).
- `maturityDate = start + term_months`.
- `currentValue`: accrues to `min(today, maturity)`; for **revolving** debts
  (`term_months <= 0`) it accrues to today with no cap and never matures.
- `summarize(items)` → `{ principal, currentValue, interest, maturityValue }` (savings).
- **Debts support repayments.** `debt_payments` rows feed `owed(debt, payments)`, a
  **declining-balance** calc: interest accrues on the outstanding balance between
  payments; each payment reduces it (floored at 0). Fixed-term debts stop accruing at
  maturity, revolving ones accrue to today. The dashboard net worth and the debts table
  both use `owed(...)`, not `currentValue`, so payments reduce what's owed everywhere.
Savings estimates ignore intermediate withdrawals; debt estimates DO account for
recorded repayments but not for fees/minimum-payment rules.

## Subscriptions (`lib/subscriptions.ts`)

A subscription is a **rate of spend**, not a balance, so it is the one tracked entity that
never touches net worth. `amount` is what a single charge costs *in that plan's own period*
(a yearly plan stores the year's price); `monthlyCost` / `yearlyCost` put a weekly plan and
an annual one on the same ruler.

Nothing about a future charge is stored. Every renewal is derived from `start_date` by
counting forward — `chargeAt(s, k)`, never chaining off the previous charge, which is what
keeps a plan that bills on the 31st billing on the 31st after a short February. `addMonths`
clamps, so the arithmetic guess in `periodsBefore` can land a day either side of the real
charge and every caller walks the last step or two onto the schedule.

`cancelled_date` is the entire cancellation state — NULL means still billing. Deliberately
one column, unlike `debts` (`archived` + `settled_date`), which can disagree. A cancelled
plan bills nothing from that date, keeps what it cost you (`spentToDate`), and drops out of
`listSubscriptions()` unless you pass `true`.

`monthlyForecast` is what the page's bar chart draws: twelve whole calendar months from the
current one, counting every charge that falls in each. A ₫/month figure spreads an annual
renewal evenly across the year — the chart is what shows you the month it actually lands in.

## Goals (`lib/goals.ts`)

A goal is a **target on a metric the app already computes** — `net_worth`, `investments`,
`savings` or `debts` — with an optional `target_date`. It stores no balance: progress is
derived from the live metric on every render, so it can't go stale. `debts` counts *down*
to its target; `baseline` is where progress is measured from (a payoff bar starts empty).

`project(goal, world)` answers "do I get there, and what does it cost per month". Its
assumptions are deliberately conservative — an "on track" never depends on luck:
- **Market return is 0%.** Investments grow only by contributions.
- **Pace** comes from, in order: the goal's own `monthly_plan` → active `recurring_rules`
  (the *committed* forward rate) → the trailing 6-month contribution average.
- **Debts** default to their own repayment path (`projectedOwed`): credit lines shrink by
  `monthly_payment`; fixed/flexible ones decline straight-line to zero at maturity. Note
  `debtOwed()` can't be asked about a future date directly — it would accrue interest but
  subtract only *recorded* payments, projecting every debt as growing forever.
- **A `monthly_plan` on a debt goal replaces that schedule** rather than adding to it —
  hence the `paceRepaysDebt` flag threaded through `valueAt()`.

`GoalWorld` carries `nowMs` as well as `today`: interest accrues by the second, so a goal
anchored to midnight would print a different net worth than the hero right above it.
