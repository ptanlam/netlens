# Architecture

A single-user net-worth tracker. The **SQLite database is the source of truth**; the
UI is a thin layer over it. No external state, no API layer beyond a couple of route
handlers.

## Data flow

```
better-sqlite3 (data/investments.db, WAL)
        │  lib/db.ts  — schema + pure CRUD (server-only, imports better-sqlite3)
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
`lib/` files that do **not** import `better-sqlite3`: `types.ts`, `format.ts`,
`savings.ts`, `utils.ts`. Anything importing `better-sqlite3` (i.e. `lib/db.ts`,
`lib/prices.ts`, `lib/pnl.ts`) is server-only.

## Directory map

| Path | Role |
|------|------|
| `lib/db.ts` | Schema (`SCHEMA` const) + all SQL. `getDb()` runs the schema on first use. Money stored as integer VND. |
| `lib/types.ts` | Shared interfaces + `as const` arrays (`ASSET_TYPES`, `INTEREST_TYPES`, `PRICE_SOURCES`). Client-safe. |
| `lib/savings.ts` | Interest maths over the `Accruing` shape — used by BOTH savings and debts. |
| `lib/goals.ts` | Goal progress + the forward projection. Pure; reads a `GoalWorld` gathered by `db.buildGoalWorld()`. |
| `lib/settings.ts` | `SETTINGS_SECTIONS` — the settings rail, shared server/client. |
| `lib/pnl.ts` | Reconstructs the daily P&L series from transactions + `price_history`. |
| `lib/prices.ts` | Live/historical price fetching (CoinGecko, Yahoo, fmarket, VCBF). Never throws; collects errors. |
| `lib/format.ts` | `fmtVND` (₫ with `.` thousands), `fmtTr` (axis short form: `40tr`), `MONTHS`. |
| `lib/auth.ts` | Token helper for the optional password gate. |
| `app/actions.ts` | Every mutation (transactions, holdings, recurring, savings, debts, auth). |
| `app/**/page.tsx` | One server component per route. |
| `components/ui/*` | Base UI primitives wrapped shadcn-style. Don't reinvent — reuse these. |
| `components/*-manager.tsx` | Client CRUD UIs (recurring, savings, debts). |
| `components/dashboard-charts.tsx` | The dashboard's date-range picker + all charts. |
| `components/net-worth.tsx` | Net worth = investments + savings − debts panel. |
| `components/nav.tsx` | `LINKS` array → desktop nav + mobile side-drawer. |
| `proxy.ts` | Middleware-style auth gate (redirects to `/login` when `APP_PASSWORD` is set). |

## Routes

Pages: `/` (dashboard), `/transactions`, `/holdings`, `/savings`, `/debts`, `/goals`,
`/recurring`, `/settings/appearance`, `/settings/price-sources`, `/login`.
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

## Data model (tables in `lib/db.ts` `SCHEMA`)

`transactions`, `instruments`, `recurring_rules`, `price_history`, `meta`,
`savings`, `debts`, `debt_payments`, `goals`. All use `CREATE TABLE IF NOT EXISTS`, so **adding a
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
