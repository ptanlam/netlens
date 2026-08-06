# Fix: `/api/pnl-history` unbounded work on every Live-price tick

## Symptom

A user leaves the app open for a long time (Live prices armed, especially at a fast
interval) and memory/resource consumption climbs until it exceeds Cloudflare's free-tier
capacity.

## Root cause

`app/api/pnl-history/route.ts` recomputes the **entire** multi-year P&L history from
scratch on every poll — including the `?today=1` "fast path" — and `LivePrices`
(`components/live-prices.tsx`) polls this endpoint as often as every 5 seconds for as
long as the tab stays open.

Chain of events:

1. `components/live-prices.tsx:233-243` — when Live is armed, a `setTimeout` loop calls
   `run(true)` on every tick, indefinitely, for as long as the tab is open. 5s is the
   fastest selectable interval.
2. Each tick fires `refreshPrices()` (a server action) **and**, via
   `components/dashboard-charts.tsx:106-118`, a `GET /api/pnl-history?today=1`.
3. The handler (`app/api/pnl-history/route.ts:10-19`):

   ```ts
   export async function GET(req: Request) {
     const todayOnly = new URL(req.url).searchParams.has("today");
     const errors = todayOnly ? [] : (await refreshHistory())[1];
     const { series, holdings } = await buildDaily();   // ← always runs in full
     return NextResponse.json(
       todayOnly
         ? { series: series.slice(-1), holdings: holdings.slice(-1), errors } // sliced *after*
         : { series, holdings, errors },
     );
   }
   ```

   The comment above this handler claims `?today=1` "skips… re-pulling every
   instrument's daily candles" — it doesn't. `buildDaily()` (`lib/pnl.ts:45`) always
   runs in full:
   - pulls **every** transaction ever recorded (`pnlTransactions()` — unfiltered
     `SELECT * FROM transactions`)
   - pulls **every** price-history row for **every** instrument
     (`priceHistoryByInstrument()` — unfiltered `SELECT * FROM price_history`)
   - loops **day-by-day from the first transaction to today, across every tracked
     holding**, allocating a `series[]` + `holdings[]` (each day carrying a nested
     per-holding array) for the whole span
   - only *after* building the whole thing does it slice off the last element for the
     `today=1` response.

Per-request cost (D1 rows read, CPU, allocated arrays) is
`O(days_since_first_transaction × holdings)`, and it grows a little more **every
calendar day** the app is used — but it's paid on **every single Live tick**, not once.
At the fastest Live setting that's up to 720 full historical reconstructions per hour
from a single open tab. This is what quietly exceeds Cloudflare's free-tier D1
row-read / Worker request / CPU budgets over a long-running session — not a classic
pointer leak, but unbounded, repeated, full-history work disguised as "just today."

This also explains the "grows worse over time" texture of the bug: the longer the app
has been in use, the more expensive *every single tick* becomes (more days to walk),
independent of how long any one tab has been open.

### Second contributor (found during implementation planning)

The `?today=1` fetch is not the only thing each Live tick pays for. `useRefreshPrices`
also calls `router.refresh()` (`components/live-prices.tsx:153-155`), which re-renders
the whole dashboard server-side on **every tick**. That runs `app/page.tsx`, which calls
`db.materializeRecurring()` plus an eight-way `Promise.all` — including
`db.buildPayload()`, whose very first query is another unbounded full-table scan:

```ts
q("SELECT date, asset_type, amount FROM transactions ORDER BY date, id")   // lib/db.ts:803
```

It is returned as `Payload.contributions` (`lib/types.ts:190`) and serialized into the
RSC payload every time. **Nothing reads it.** Grepping every consumer of `Payload` finds
no reference to `payload.contributions`; the only `.contributions` hits in the codebase
are the unrelated `GoalContribution` records. So every Live tick reads and ships the
entire transactions table for a field that is dead on arrival.

## Fix plan

1. **Make `?today=1` actually cheap — stop calling full `buildDaily()` for it.**
   Options, in order of preference:
   - a. Narrow-fetch fast path: pull only the last 1-2 days of transactions and price
     history (mirrors the pattern already used by `refreshRecentHistory` in
     `lib/prices.ts`) and compute just the latest point(s) from that, without touching
     the full history tables.
   - b. Cache the full `buildDaily()` result server-side (in-memory per isolate, or a
     small D1/KV cache) keyed off `history_fetched_at` / the price-refresh counter, and
     on `?today=1` splice a freshly-computed last day onto the cached series instead of
     rebuilding everything.

   Prefer (a): it directly fixes the O(days) query pattern rather than papering over it
   with a cache that still has to be invalidated correctly, and it reuses an approach the
   codebase already trusts (`refreshRecentHistory`).

2. **Bound `buildDaily()`'s cost independent of total history length.** Since days only
   ever grows, consider memoizing the "settled" portion of the series (everything before
   today never changes once its close is stored — see `lastClose` in `lib/pnl.ts`) and
   only recomputing the last day or two per call, even for the full (non-`today`) path.

3. **Re-check the Live interval floor.** 5s is aggressive for a computation this heavy.
   Even after (1)/(2) land, decide whether anything below 30s is worth offering in
   `INTERVALS` (`components/live-prices.tsx:42-49`).

4. **Verify the fix.** During `pnpm dev`, log/measure rows read per request (or D1 query
   count) for `GET /api/pnl-history?today=1` before and after — confirm it no longer
   scans the full `transactions` / `price_history` tables. Re-check with
   `pnpm preview` (real `wrangler dev`) since `pnpm dev` runs on Node and won't reflect
   Worker-side limits.

---

# Implementation details

> **Status.** Steps 0 and 1 are done. Parity with `buildDaily` was verified black-box,
> including the three paths the dataset doesn't naturally exercise. Steps 2 and 3 remain
> open — and production data so far argues against needing either.
>
> **Correction (post-deploy).** Step 1 shipped with `recentCloses` written as a
> `ROW_NUMBER() OVER (PARTITION BY ...)` window function. It was correct but **not
> bounded**: SQLite cannot rank within a partition without reading every row the `WHERE`
> admits, so `EXPLAIN QUERY PLAN` showed `SCAN price_history` and `wrangler d1 insights`
> measured ~22k rows read per call against a 5.5k-row table. Local wall-clock could never
> have caught this — a scan of 5.5k rows still returns in single-digit ms. Rewritten as one
> indexed seek per instrument (`SEARCH ... (instrument=? AND date<?)`) batched into a single
> round trip: **2 rows per instrument**, confirmed against remote D1.
>
> **Lesson worth keeping:** for a "top N per group" query, check `EXPLAIN QUERY PLAN`.
> A window function reads the whole partition set; N indexed seeks in a `batch()` do not.

## Step 0 — drop the dead `Payload.contributions` field (5 minutes, zero risk)

Do this first: it is independent, removes a full-table scan from every dashboard render,
and shrinks the RSC payload.

- `lib/db.ts:803` — delete the `txRows` query from the `Promise.all` in `buildPayload()`.
- `lib/db.ts:835` — drop `contributions: txRows,` from the returned object.
- `lib/types.ts:190` — remove `contributions` from the `Payload` interface.

`npx tsc --noEmit` is the proof: if anything did read it, the build breaks. It doesn't.

## Step 1 — the `?today=1` fast path

### Why the last point is cheap to compute (the derivation this rests on)

In `buildDaily()`'s day loop, at `ds === end` (today), the per-instrument unit count
collapses to a constant. All events have `date <= today`, so by the last iteration every
event has been consumed and `cumUnits[name] === totalUnits`. Since
`offset = qtyNow - totalUnits`:

```
units = max(offset + cumUnits[name], 0)
      = max(qtyNow, 0)          where qtyNow = inst.quantity ?? totalUnits
```

So **the entire day-by-day walk is irrelevant to the final point.** What today's point
actually needs:

| Field | Depends on | Cost |
|---|---|---|
| `date` | `todayIso()` | free |
| `invested` | `SUM(amount)` over txs with `date <= today` | 1 aggregate row |
| `units` (per instrument) | `inst.quantity`, else `totalUnits` | free / see below |
| `price` | `livePrice ?? priceAt(today)` | newest close per instrument |
| `prevValue` (for per-holding `pnl`) | `round(unitsYesterday × priceAt(yesterday))` | 2nd-newest close |
| `contribToday` | txs dated exactly today | 1 aggregate row per instrument |
| `baseline` | `priceAt(yesterday)` + `anchorAt(yesterday)` | same 2 closes |
| `status` | always `"live"` when `ds === end` | free |

`held` / `settled` / `lastClose` only feed `status`, which is unconditionally `"live"` on
the last day — so they can be skipped entirely.

Note `unitsYesterday = max(qtyNow − unitsFromTxsDatedToday, 0)`, and that `livePrice` is
applied *only* at `ds === end`, so yesterday's price is always the stored close.

### New DB helpers (`lib/db.ts`)

All three are bounded by instrument count or by today's transactions — **none by the
number of days of history.**

**1. Per-instrument transaction aggregate** — one row per instrument, replacing the
full `pnlTransactions()` scan:

```sql
SELECT instrument,
       SUM(amount)                                     AS invested,
       MIN(date)                                       AS first_date,
       SUM(CASE WHEN date = ?1 THEN amount ELSE 0 END) AS today_amount,
       SUM(CASE WHEN date = ?1 AND quantity IS NOT NULL
                THEN quantity ELSE 0 END)              AS today_qty,
       SUM(CASE WHEN date = ?1 AND quantity IS NULL
                THEN amount ELSE 0 END)                AS today_amount_unqty
FROM transactions
WHERE date <= ?1
GROUP BY instrument
```

Keep the `WHERE date <= ?1`: `buildDaily` consumes txs with `txs[txI].date <= ds`, so a
future-dated transaction is *not* counted in `invested`. Dropping the filter would make
the fast path disagree with the full path for anyone who post-dates an entry.

`today_qty + today_amount_unqty / priceAt(today)` reconstructs the units bought today
(mirroring `t.quantity != null ? t.quantity : t.amount / priceAt(t.date)`).

**2. The two most recent stored closes per instrument** — window function, supported by
D1's SQLite:

```sql
SELECT instrument, date, price FROM (
  SELECT instrument, date, price,
         ROW_NUMBER() OVER (PARTITION BY instrument ORDER BY date DESC) AS rn
  FROM price_history
  WHERE date <= ?1
) WHERE rn <= 2
```

Two rows is exactly enough: `rn = 1` is `priceAt(today)`. For
`priceAt(yesterday)`/`anchorAt(yesterday)`, use `rn = 1` when its date is `<= yesterday`
(the feed hasn't settled today yet), otherwise `rn = 2`. The row's `date` column *is*
`anchorAt`.

Caveat to preserve: `buildDaily` classifies an instrument as *tracked* vs *manual* on
`history[inst.name]?.length` over **all** rows, not date-filtered. An instrument whose
only price rows were future-dated would classify differently here. That is not a real
state, but if you want exact parity, classify membership with a separate
`SELECT DISTINCT instrument FROM price_history` instead of relying on the filtered result.

**3. `totalUnits`, only for instruments with `quantity IS NULL`** — skip the query
entirely when there are none:

```sql
SELECT t.instrument, t.amount, t.quantity, t.date,
       (SELECT p.price FROM price_history p
         WHERE p.instrument = t.instrument AND p.date <= t.date
         ORDER BY p.date DESC LIMIT 1) AS px_at,
       (SELECT p.price FROM price_history p
         WHERE p.instrument = t.instrument
         ORDER BY p.date ASC LIMIT 1)  AS px_first
FROM transactions t
WHERE t.date <= ?1 AND t.instrument IN (…)
```

`px_at ?? px_first` mirrors `priceLookup`'s `ans >= 0 ? ans : 0` fallback for a
transaction predating every stored price.

This is the one remaining unbounded-ish read, and it is `O(txs for those instruments)` —
**not** `O(days)`. In practice a tracked instrument with `quantity == null` is a fund
purchase awaiting unit confirmation (see `db.pendingFundUnits`), so this is rare,
transient, and small. If it ever becomes hot, cache `totalUnits` per instrument and
invalidate on transaction write.

### New `lib/pnl.ts` export

```ts
export async function buildLatest(): Promise<{
  point: PnlPoint | null;
  holdings: HoldingPnlPoint | null;
}>
```

Put it directly beside `buildDaily` and have both share the `livePrice` /
`NAV_STRATEGIES` rule so the two can't drift on that detail.

Two details that must be copied exactly or the last chart point will visibly jump when a
tick lands:

- The aggregate `value` sums the **unrounded** `raw` per instrument and rounds once at
  the end, while each `dayHoldings` entry uses the **rounded** `v`. Preserve both.
- A holding is emitted into `dayHoldings` only `if (v !== 0 || pnl !== 0)`.

For manual instruments (no price history): `v = today >= first_date ? manual_value : 0`,
and `prevValue` is the same unless `first_date === today`.

### Route change (`app/api/pnl-history/route.ts`)

```ts
export async function GET(req: Request) {
  const todayOnly = new URL(req.url).searchParams.has("today");
  if (todayOnly) {
    const { point, holdings } = await buildLatest();
    return NextResponse.json({
      series: point ? [point] : [],
      holdings: holdings ? [holdings] : [],
      errors: [],
    });
  }
  const errors = (await refreshHistory())[1];
  const { series, holdings } = await buildDaily();
  return NextResponse.json({ series, holdings, errors });
}
```

The client contract is unchanged: `withLatest()`
(`components/dashboard-charts.tsx:56-64`) splices by `date`, so a one-element array with
the same date string is exactly what it already expects. Fix the stale comment above the
handler while you're there — it currently describes behaviour the code never had.

## Step 2 — bound the full path (defer unless still needed)

Re-measure after Steps 0-1 before doing this. The full path runs **once per dashboard
mount**, not per tick, so it is far less severe — and it may well be acceptable as-is.

If it isn't, the payload is the thing to attack before the computation: `holdings` is
one entry per day per holding (years × ~10 holdings), and it exists to serve two
consumers — `PnlCalendar`, which only ever renders one month at a time, and
`HoldingsListCard`'s per-holding sparklines. Serving the calendar a month at a time and
the sparklines as pre-downsampled arrays would cut the response by an order of magnitude
without touching `buildDaily`'s internals.

Memoizing the settled prefix of the series (everything before today is immutable once
its close is stored — see `lastClose` in `lib/pnl.ts`) is the heavier option, and needs a
cache store plus invalidation on every `upsertPriceHistory` write.

## Step 3 — Live interval floor

`INTERVALS` (`components/live-prices.tsx:42-49`) offers 5s. Even after Steps 0-1, each
tick is a server action + an RSC re-render + an API call. Dropping the 5s option (leaving
30s as the floor) cuts the worst case by 6× for free. Judgement call — the existing
comment argues 5s is deliberate for watching crypto move.

## Step 4 — verification

No test runner is configured in this repo, so verify by measurement:

1. **Parity check (do this before trusting the fast path).** Temporarily, in the
   `todayOnly` branch, compute both and compare:
   ```ts
   const full = await buildDaily();
   console.assert(
     JSON.stringify(full.series.at(-1)) === JSON.stringify(point),
     "buildLatest drifted from buildDaily",
   );
   ```
   Exercise it against real data with holdings in each state: `quantity` set, `quantity`
   null, manual-value (no price history), a NAV fund, and a transaction dated today.
   Remove the assertion once clean.
2. **Row counts.** With `pnpm dev`, log D1 query count / rows read for
   `GET /api/pnl-history?today=1` before and after. The target: constant in the number of
   days of history, where it was previously linear.
3. **Worker reality.** Re-check under `pnpm preview` (real `wrangler dev`) — `pnpm dev`
   runs on Node and won't reflect Worker CPU/subrequest limits.
4. `npx tsc --noEmit` + `pnpm lint` clean, then a headless-Chrome screenshot of the
   dashboard confirming the chart's last point and the calendar's today cell are
   unchanged, per `docs/WORKFLOW.md`.

## Suggested commit sequence

1. `perf(dashboard): stop shipping every transaction in the payload` — Step 0.
2. `perf(api): compute today's P&L point without rebuilding all history` — Step 1.
3. (optional) Step 3, then re-measure and decide on Step 2.

## Out of scope / not the cause

Investigated and ruled out during diagnosis:

- No unbounded module-level caches/Maps/Sets in `lib/db.ts`, `lib/prices.ts`,
  `custom-worker.ts` (only a single cached auth token, bounded).
- `LivePrices`' `setInterval`/`setTimeout` chains are correctly cleared on unmount —
  not a client-side timer leak.
- `PortfolioChart` is a hand-rolled SVG chart (not Recharts) with a properly
  disconnected `ResizeObserver` — not a chart-library leak.
- The cron (`custom-worker.ts` `scheduled` handler) runs independently of any open tab
  and self-throttles (`refreshHistory` 12h gate, `sweepRecentHistory` 30m gate) — not
  related to "leave the tab open" behavior.
