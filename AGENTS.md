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

Next.js 16 (App Router, Server Actions, Turbopack) · React 19 · **@base-ui/react** primitives wrapped in `components/ui/` (shadcn-style), themed as the **Wise design system** (`DESIGN.md`, tokens in `app/globals.css`) · Tailwind CSS v4 · @tanstack/charts · **Cloudflare D1** via `@opennextjs/cloudflare` · sonner (toasts) · next-themes.

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

## Prices refresh on the server, on one clock

**A browser never fetches prices on a timer.** The cron in `custom-worker.ts` is the only
scheduled refresher; the cadence is one account-wide row in `meta` (`price_refresh_ms`,
default 5m, `Off` allowed), written by the header pill via `setPriceRefresh` and read by
`refreshScheduled()` in `lib/prices.ts`. The Cron Trigger fires every minute and that
function decides whether the minute is due — which is why the cadence is a setting rather
than a `wrangler.jsonc` edit, and why nothing below a minute is on the menu.

`components/live-prices.tsx` only *watches*: it polls `GET /api/price-status` (one `meta`
read) and, when `meta.prices_refreshed_at` moves, bumps the refresh count and
`router.refresh()`es a route that draws prices. The two paths still allowed to fetch from a
browser are both deliberate acts — the header's Refresh button and the pull-to-refresh
gesture. **Don't re-add an open-time or interval fetch here**: that made every visit spend a
round of upstream API calls, and put the schedule in whichever tab happened to be open.

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


## Real estate (land valuation)

`/real-estate` is a table of every Real Estate holding (booked vs predicted, valued on the
server so no comps are shipped to it); each row opens `/real-estate/<name>` — the plot's
prediction, comp map, its comps, bookings and area index. On Investments, a Real Estate
holding's row links there ("Valuation"). Shared UI pieces live
in `components/real-estate-parts.tsx`; `revalidateAll` revalidates `/real-estate` as a
*layout* so every plot page refreshes. The app estimates a holding's worth from **where it is**
(`lib/realestate.ts`, schema in `migrations/0008_property_valuation.sql`). The evidence is
comps: sales you enter, or **Nhà Tốt listings** pulled in by "Find listings nearby"
(`lib/listings.ts` — Chợ Tốt's undocumented public feed, queried by lat/lng + whole-km radius,
only on that button press, never on a schedule; imports dedupe on the listing URL in `source`):

- **`properties`** places a holding (keyed by instrument name): lat/lng, area, land use,
  road access, and the radius comps count within.
- **`property_comps`** are comparable plots — a sale or a listing — and **each belongs to one
  plot** (`instrument`, migration `0010`). They used to be shared by every plot in reach; they
  aren't any more, because each is gathered *for* a plot and one plot's evidence turning up in
  another's estimate was a surprise. The same listing may be a comp for two plots — as two rows.
  Filter by `instrument` everywhere comps feed an estimate (`db.listComps(instrument)`).
- **`property_index`** is an optional area price series per property; only ratios between
  dates are used, to carry old comps and the purchase price forward.

The estimate is the weighted median ₫/m² of comps (land use must match; distance, age, road
and plot size only weigh; asking prices lose `ASKING_DISCOUNT`), shrunk toward what you paid
(`PRIOR_WEIGHT`) while the evidence is thin. **It never moves net worth by itself**: "Book the
low end" books the low end, deliberately and conservatively. Nothing derived is stored.

- **Bookings are dated** (`property_valuations`, migration `0009`). A past day is valued at the
  latest booking on or before it (`manualAt` in `lib/pnl.ts`, used by BOTH `buildDaily` and
  `buildLatest`), so a gain lands on the day you booked it, not the purchase day. The first
  booking also writes the value it replaced, dated at the first purchase (`initial`). Undo =
  delete the row. `manual_value` is kept equal to the latest row, so nothing that reads today's
  value changed. Typing a Real Estate value on Investments books it too (`recordManualEdit`).
- **Auto-comps** (`properties.auto_comps` = N, 0 off): the cron, once a day
  (`refreshAutoCompsScheduled`), and a save of the location replace the rows that property's
  refresh owns (`property_comps.auto_for`) with the N nearest same-land-use listings, less any
  that plot already keeps by hand. Hand-added or ticked comps (`auto_for` NULL) are never touched; editing an
  auto comp adopts it.

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

Two levers: what you **bought** into investments (`transactions`, purchases only — sells are not
subtracted) and **new deposit principal** (`savings`). Neither can be negative, so no month can be.

Both of those are deliberate narrowings, and both cost something:

- **Sells used to net off.** That stopped a sale being counted twice when its proceeds landed on
  something else the app tracks, but it also read a sale you simply held in cash as dissaving —
  which the app cannot tell apart, having no cash account. Selling investments to repay a debt now
  counts on both sides.
- **Fund cash and debt repayments used to be levers too.** They are out: a repayment is mostly a
  promise being kept rather than a decision to save, and fund cash is money moved between your own
  pockets. What is left is the two acts that put money to work — which is also what the recurring
  rules setting the bar are made of, so the bar and the levers now measure the same thing.

The bar is `commitment()`: your recurring rules, else your goals' `monthly_plan`, else none — only
things you declared on purpose. A trailing average of your own past would be a treadmill. **No
commitment, no streak**: the card renders an empty state, mirroring a goal's `stalled`.

A month short of the bar still counts if the trailing 3-month average clears it (`carried`) —
lumpy income is not a lapse. The current month is `open`, never `missed`, and the card shows the
**shortfall**, never a countdown: "your streak dies in 3 days" is loss aversion pointed at a
financial decision. The shortfall is the *cheaper* of clearing the bar or lifting the average.

The month breakdown is a **controlled** `<Tooltip open=…>` over a real `<button>` per column,
and it has to stay both: left to itself a tooltip opens on hover and focus, which a phone has
neither of — the columns were decoration there, carrying a popup nothing could open. Driving
`open` from the card's own state means a tap opens the same popup a pointer does, with no
second mobile-only layout to keep in step. A second tap on the same column closes it, since on
touch there is no "pointer away".

Each lever has its own colour from the fixed chart palette (`LEVER_COLOR`): ink for money invested,
as in the design's "Invested per month" bars, and Wise Green for new deposits. A column's height is
the month's total and each segment takes its share of it, so the top edge is exactly the figure the
commitment line judges. Missed months keep their hues but drop back — you still put that money
somewhere.

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
