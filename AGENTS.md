<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent guide

Personal net-worth tracker: **investments, savings (term deposits), debts (loans + credit cards), subscriptions (recurring charges)**, with a dashboard. Read this first, then the deep docs in [`docs/`](docs/).

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the app is wired (data → actions → pages).
- [`docs/ADDING_A_FEATURE.md`](docs/ADDING_A_FEATURE.md) — copy-paste recipe for a new tracked entity (savings/debts are the templates).
- [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) — money, formatting, UI, and lint gotchas.
- [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — run, verify, and visually test (headless Chrome).
- [`docs/CLOUDFLARE.md`](docs/CLOUDFLARE.md) — Workers/D1 deployment, data migration, and what the port changed.

## ⚠️ Read before touching anything

1. **This is the right app.** There are TWO similarly-named apps on this machine:
   - ✅ **This one** — Next.js 16, at the repo root (`.../_personal/investment-visualization`), port **3000**. Edit here.
   - ❌ Legacy **Flask** app at `~/Projects/personal/investment-visualization` (note: `personal`, no underscore), port **8000**. Do NOT edit unless explicitly asked.
2. **A Docker container often holds port 3000** (an old build). `pnpm dev` then falls back to **3001** and prints the URL — always test against the port it prints.
3. **Storage is Cloudflare D1, not a local SQLite file.** `pnpm dev` binds a local D1 (a Miniflare SQLite file under `.wrangler/`); production is a real D1 database. `data/investments.db` is the *old* better-sqlite3 file, kept only as the migration source. Read [`docs/CLOUDFLARE.md`](docs/CLOUDFLARE.md) before touching storage or deployment.
4. **`pnpm dev` is not the real runtime.** It still runs on Node and will accept things the Worker won't. Use `pnpm preview` (a real `wrangler dev`) before believing a change works.

## Stack

Next.js 16 (App Router, Server Actions, Turbopack) · React 19 · **@base-ui/react** primitives wrapped in `components/ui/` (shadcn-style) · Tailwind CSS v4 · @tanstack/charts · **Cloudflare D1** via `@opennextjs/cloudflare` · sonner (toasts) · next-themes.

## Architecture in 6 lines

- **`lib/db.ts`** — D1, the single source of truth. **Every function is async.** Schema lives in `migrations/`, not here. Positional `?` params only, `batch()` instead of transactions, and no query inside a loop — each one is a network round trip.
- **`lib/types.ts`** — shared types/consts, safe to import from client components (no Node deps).
- **`lib/*.ts`** — pure logic: `savings.ts` (interest maths for savings AND debts), `subscriptions.ts` (billing cycles), `pnl.ts`, `prices.ts`, `format.ts`.
- **`app/actions.ts`** — all `"use server"` mutations; each calls `revalidateAll()` after writing.
- **`app/**/page.tsx`** — server components: read from `lib/db`, render a `<Card>` + a client manager component.
- **`components/*-manager.tsx`, `*-form.tsx`** — `"use client"`; call server actions, toast, and use `<Dialog>` for add/edit.

## The feature pattern (memorize this)

Every tracked entity (transactions, holdings, recurring, **savings**, **debts**, **subscriptions**) is the same shape:

> table in a new `migrations/NNNN_*.sql` → async CRUD in `lib/db.ts` → type in `lib/types.ts` → actions in `app/actions.ts` (+ add route to `revalidateAll`) → `components/<x>-manager.tsx` → `app/<x>/page.tsx` → link in `components/nav.tsx` `LINKS` (drives desktop nav AND the mobile drawer).

Apply the migration with `pnpm db:migrate` (local). Production is handled by `pnpm run deploy`, which migrates the remote D1 between the build and the deploy — so **keep migrations additive**, since the old Worker serves the gap between the two. See [`docs/CLOUDFLARE.md`](docs/CLOUDFLARE.md#migrations-run-as-part-of-the-deploy-in-this-order).

`savings` and `debts` are near-identical templates — copy one. See `docs/ADDING_A_FEATURE.md`.

## Must-know gotchas

- **`searchParams` and `params` are Promises** in page props — `await` them (e.g. `app/transactions/page.tsx` reading `?holding=`).
- **Base UI `<Button render={<Link/>}>`** needs `nativeButton={false}` or it warns.
- **React Compiler lint (`react-hooks/immutability`)** forbids reassigning a captured variable inside a `.map()` in `useMemo` (e.g. `sum += x`). Use prefix sums / `reduce` instead.
- **Money is whole-VND integers** (signed: + in, − out). Format with `fmtVND` / `fmtMil` from `lib/format.ts`. Never hardcode currency.
- **Verify every change**: `npx tsc --noEmit` + `pnpm lint`, then a headless-Chrome screenshot for UI. Both must be clean. Details in `docs/WORKFLOW.md`.

## Money & interest

`lib/savings.ts` holds the shared interest maths over an `Accruing` shape (`{principal, rate, start_date, term_months, interest_type}`). Savings deposits and debts both use `currentValue` / `maturityValue` / `summarize` / `isMatured`. A debt with `term_months <= 0` is **revolving** (credit card): open-ended, never matures. The dashboard **Net worth = investments + savings + fund cash − debts** (`components/net-worth.tsx`).

## Subscriptions

A subscription is a **rate of spend**, and the only tracked entity that deliberately stays
out of net worth — it is neither a thing you own nor a debt you owe. `amount` is one
charge in that plan's own period (a yearly plan stores the year's price); `lib/subscriptions.ts`
derives ₫/month, the next renewal, what it has cost you, and the 12-month forecast, all by
counting forward from `start_date`. Nothing about a future charge is stored.

`cancelled_date` is the whole cancellation state (NULL = still billing) — one column, not a
flag plus a date. Cancelling keeps the row and its history; deleting is for a row you added
by mistake.

## Goals & sinking funds

A goal is a target on a metric (`lib/goals.ts`, `GOAL_METRICS`). Four metrics are figures the app already computes; **`fund`** is a sinking fund (a car, a wedding) and is the only one that stores state:

- **Cash** you set aside lives in `goal_contributions` (a ledger — negative rows are withdrawals). It earns nothing.
- **Interest** comes from earmarking real deposits: `savings.goal_id` ties a deposit to a fund, and each keeps its own rate and term. There's deliberately no fund-wide rate — you take whatever rate was on offer the month you had the money.
- **Counted once.** An earmarked deposit stays in the Savings line of net worth; only the un-deposited cash is the extra "Set aside" line. `db.fundsCashTotal()` is cash-only for exactly this reason.
- **A net-worth goal excludes everything earmarked** (`earmarkedAt` in `lib/goals.ts`): the money is yours, but it's spoken for, so it can't count toward a number you mean to keep.
- **"Mark as bought"** drains the cash and *un-earmarks* the deposits — it never deletes them. The bank still holds a deposit until you break it; delete it on the Savings page then.

### A target in another currency

A goal can be denominated in foreign money ("Race to $100k"): `goals.target_ccy` + `target_amount` (whole units) hold what you actually said, and `target` is the VND it converts to.

- **Read `GoalProjection.target`, never `Goal.target`, to display a target.** The projection converts at request time; the column is a cache, only as fresh as the last FX refresh (`syncFxTargets` re-writes it). The cache exists so a raw `SELECT` and a rate outage both still see a sane number.
- **The rate is `meta`, not an `instrument`** (`fx_usd_vnd`, `fx_fetched_at`, `fx_source`; helpers `db.fxRates` / `setFxRates`). A currency is not a holding — as an instrument the dollar would turn up in the portfolio, the allocation donut and the P&L series.
- **Vietcombank's `sell` rate**, fetched by `refreshFxRates` inside `refreshAll` (self-throttling, 30 min). A bank rather than the interbank feed because the question is what $100k *costs* you, and `sell` is both that side and the conservative one.
- A live target means a goal can slip to "Behind" on a week you saved perfectly well, so every screen showing one also shows the amount, the rate, the source and the timestamp (`FxNote`).


## Streak

The saving streak (`lib/score.ts`, `components/streak-card.tsx`) **opens the dashboard's analysis
column**, above the portfolio chart — the deliberate order being that the chart is what the market
did to you and the streak is what you did yourself, and only one of those you can act on. It counts
consecutive **months** you cleared your own monthly commitment. Three rules, and they are the
whole design — see `plans/points-and-streaks.md` for the reasoning:

- **Nothing is stored.** No `streak` column, no points ledger, **no migration**. Every figure is
  derived from dated rows per request, so correcting an old transaction correctly rewrites the
  streak — and you never have a counter you'd protect by leaving a mistake in place.
- **Only money that moved counts**, never app usage. You enter your own data here, so rewarding
  a login or a logged row would be farmable in one keystroke and would pay you to type fiction.
- **Market movement is excluded**, exactly as `lib/goals.ts` assumes zero return. A bull market
  must not hand you a streak and a crash must not break one.

Four levers, one per page that already exists: net money in (`transactions`, **signed** — a month
of net selling is negative), new deposit principal, fund cash set aside (netted per fund per
month, floored at 0 so buying the thing you saved for isn't a lapse), and repayments **beyond**
what the schedule required (counting them in full would just say "you paid your mortgage").

The bar is `commitment()`: your recurring rules, else your goals' `monthly_plan`, else none — only
things you declared on purpose. A trailing average of your own past would be a treadmill. **No
commitment, no streak**: the card renders an empty state, mirroring a goal's `stalled`.

A month short of the bar still counts if the trailing 3-month average clears it (`carried`) —
lumpy income is not a lapse. The current month is `open`, never `missed`, and the card shows the
**shortfall**, never a countdown: "your streak dies in 3 days" is loss aversion pointed at a
financial decision. The shortfall is the *cheaper* of clearing the bar or lifting the average.

The dashboard passes **every** debt (`listDebts(true)`) into the streak and filters for the
net-worth figure: a settled debt's old repayments are still history, and dropping them would
retroactively break the streak you earned by paying it off.

Each lever is drawn in **the hue of the page it came from** (`LEVER_COLOR`) — the same five-slot
palette the nav tints its sections with and `GoalStrip` fills its bars from. A column's **height is
the month's net**, since that is what the commitment line judges, and the segments take their
*share* of it from the gross: drawing gross-up and gross-down instead let a month that sold ₫59M to
repay ₫74M of debt cross a line it had not cleared. A net-sell month hangs below the baseline in
the negative ink. Missed months keep their hues but drop back — you still put that money somewhere.

## Where the portfolio panels live

**Allocation and Top holdings are on `/investments`**, not the dashboard: the dashboard's job is net
worth and the shape of the year, and "how is the portfolio split" is a question about the page that
lists the holdings. They live in `components/portfolio-panels.tsx` and are driven by `LivePayload`,
which `/investments` builds for free with the pure `db.livePayload(instruments, costBy)` — no extra
query. `typeColor` has one home there now; it used to be copied into `investment-manager.tsx` too.

`components/use-pnl-history.ts` holds the `/api/pnl-history` fetch, its module-level cache and the
price-tick top-up, extracted from the dashboard so Investments can draw the row sparks without a
second implementation. **The cache is shared**, so moving between the two pages no longer rebuilds
the series the other just fetched.
