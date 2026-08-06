# Spec: make a price tick cost 4 queries instead of 19

Follow-on to [`pnl-history-memory-growth.md`](pnl-history-memory-growth.md), which fixed
what `?today=1` reads. This one is about what a *tick* does around it.

## Production measurements (1d window, taken after the Step 0/1 deploy)

Via `npx wrangler d1 insights netlens --time-period 1d --sort-by reads`:

| | value |
|---|---|
| Total rows read | **1,372,474** |
| Total queries run | **26,681** |
| `SELECT instrument, date, price FROM price_history ORDER BY ...` | **58%** of rows — 146 calls × 5,528 |
| `ROW_NUMBER() OVER (...)` window function | 22% of rows — 14 calls × 22,164 |
| everything else | ≤3% each |

The 22% is the `recentCloses` bug already fixed in `adc8b9e`; that share goes to ~0 as
the new version takes over, leaving the full-history scan at roughly **three quarters of
all rows read**.

Two different costs, two different fixes, and they are not in competition:

- **Rows read** is dominated by the full `/api/pnl-history` call — once per dashboard
  mount, 5,528 rows a time. See §3.
- **Query count** is dominated by the per-tick dashboard re-render — 19 queries a tick,
  and it scales with the Live interval. See §1 and §2.

## 1. Replace `router.refresh()` on a price tick with a data fetch

### The waste

`useRefreshPrices.run()` calls `startTransition(() => router.refresh())`, which re-renders
`app/page.tsx` server-side. That issues ~19 queries:

| call | queries | changed by a price refresh? |
|---|---|---|
| `materializeRecurring()` | 1 | no |
| `buildPayload()` | 4 | **yes** |
| `pendingFundUnits()` | 1 | no |
| `listSavings()` | 1 | no |
| `listDebtPayments()` | 1 | no |
| `listDebts()` | 1 | no |
| `fundsCashTotal()` | 1 | no |
| `listGoals()` | 1 | no |
| `buildGoalWorld()` | 8 | no — takes `investments` as a scalar |

Only `buildPayload()` reads anything a price refresh can move (`instruments.last_price`).
Your deposits, loans, repayments and goal contributions cannot change because Bitcoin did.
**~15 of 19 queries per tick re-read invariant data.**

### The shape

Extend `/api/pnl-history?today=1` — the client already calls it on every tick — to return
the price-derived figures alongside the P&L point. `buildLatest()` already reads
`listInstruments()` and `txRollup()`, which between them carry everything
`buildPayload()` needs, so this adds **no** new queries:

```ts
{
  series:   [PnlPoint],          // unchanged
  holdings: [HoldingPnlPoint],   // unchanged
  errors:   [],                  // unchanged
  live: {                        // new
    portfolioTotal: number,
    investedTotal:  number,
    pnl:            number,
    portfolio:  { name, value, type, live, cost, pnl }[],
    allocation: { type, value }[],
    pricesAsOf: string | null,
  }
}
```

`live` is exactly `Payload` minus the fields a price refresh can't touch. The client holds
`savings` / `funds` / `debts` from the initial server render and recombines.

**Do not conflate the two valuation bases.** `buildPayload` values a holding with
`holdingValue()` = `quantity × last_price`; `buildLatest` values a NAV fund at its stored
close, because a fund's `last_price` is a past valuation day's NAV (see `NAV_STRATEGIES`).
These are deliberately different and both correct in place. `live.portfolio` must be built
on the `holdingValue()` basis so the KPI tiles, allocation donut and Holdings list keep
agreeing with each other — do not reuse `holdings[0].holdings`, which is the chart's basis.

### Client changes

`DashboardCharts` already re-fetches on `usePriceRefreshCount`. Feed `live` into state and
drop `router.refresh()` from the tick path (keep it for real mutations, which is what
`revalidateAll()` is for). Panels to switch from props to state: `NetWorthPanel`
(investments row only), `SummaryCards`, `AllocationCard`, `HoldingsListCard`.

**Open question — goals.** `GoalStrip` depends on `investments`, so it would go stale
between navigations. `project()` in `lib/goals.ts` is pure and client-importable, and
`GoalWorld` is price-independent apart from the `investments` scalar — so the world could
be sent once on mount and re-projected client-side per tick. That is the correct fix;
it is also the largest piece of this work. Deferring it (goals refresh on navigation) is a
legitimate first cut.

**Expected result:** ~19 queries per tick → ~4, with no loss of freshness.

## 2. Don't tick on pages that show no prices

`LivePrices` is mounted in the nav (`components/nav.tsx:447`), so it runs on every route.
With Live armed on `/settings` or `/transactions`, each tick still fires the refresh and
re-renders a page displaying no prices — and `revalidateAll()` invalidates six routes'
caches regardless of where you are.

Gate the tick on the current route (`usePathname()`), or on whether anything price-derived
is mounted. Cheap, low-risk, independent of §1.

## 3. The full-history fetch — the real rows-read story

`/api/pnl-history` (no `today`) reads 5,528 rows a call and ran 146 times in a day: **58%
of all rows read**, and the dominant share once §1's fix lands. It is called once per
`DashboardCharts` mount, so 146 ≈ how often the dashboard was navigated to.

Worth attacking, but **not by memoizing the settled prefix** — that premise is false, see
the correction note in `pnl-history-memory-growth.md`. Better options, cheapest first:

- **Cache across remounts.** The settled history only changes when the backfill runs.
  Holding the fetched series in a module-level cache (or `sessionStorage`) keyed by day
  would collapse most of those 146 calls, since `router.refresh()` doesn't remount the
  component — only real navigation does.
- **Narrow the request.** The chart buckets to Weekly by default and the calendar shows one
  month; neither needs every daily point on first paint.

Do this only if rows-read is actually near a ceiling. At 1.37M/day it is not urgent —
measure before building.

## Explicitly rejected

- **SSE / server push.** Doesn't reduce work per update, only moves who initiates it. On
  Workers it needs a Durable Object to fan out (a stateless Worker can't be woken by cron),
  cron granularity is 1 minute so it can't match the 5s the UI offers, and a DO alarm loop
  would poll upstream feeds 24/7 — replacing a design that only works while someone is
  watching. The payoff is fan-out to many concurrent viewers; this app has one.
- **Timeseries DB for `price_history`.** 5,534 rows growing ~10/day. Nothing about that
  needs a different engine, and anything off-D1 is a network hop away from the Worker.
- **Memoizing `buildDaily`'s settled prefix.** History is mutable — `refreshHistory`
  rewrites years of closes, `sweepRecentHistory` rewrites 4 days every 30 min, and
  transaction edits shift `invested` retroactively.

## Verification

1. `npx wrangler d1 insights netlens --time-period 1d --sort-by count` before and after —
   the per-render queries (`SELECT * FROM debts`, `listSavings`, `buildGoalWorld`'s reads)
   should drop sharply in **run count** while dashboard usage stays the same.
2. Parity: the KPI tiles, allocation and Holdings list must show the same figures after a
   tick as a full page reload does. Compare against a hard refresh.
3. `npx tsc --noEmit` + `pnpm lint`, then headless-Chrome at desktop and 390px per
   `docs/WORKFLOW.md`.
4. `pnpm preview` before deploying — `next dev` runs on Node and won't reflect the Worker.
