import { NextResponse } from "next/server";
import { buildDaily, buildLatest } from "@/lib/pnl";

export const dynamic = "force-dynamic";

/** `?today=1` returns just the latest day. A price refresh can only move today's point (it
 *  stamps today into `price_history`), so the dashboard polls this on every live tick
 *  instead of asking for the whole series again.
 *
 *  It is served by `buildLatest`, which computes that one day directly. It used to call
 *  `buildDaily()` and slice the last element off the result — so the "cheap" path did the
 *  full day-by-day reconstruction anyway, reading every row of `transactions` and
 *  `price_history` to keep one point, hundreds of times an hour per open tab. */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.has("today")) {
    const { point, holdings, live } = await buildLatest();
    return NextResponse.json({
      series: point ? [point] : [],
      holdings: holdings ? [holdings] : [],
      // The price-derived dashboard figures, so a tick doesn't need `router.refresh()` —
      // which re-read savings, debts and the whole goal world to update a stock price.
      live,
      errors: [],
    });
  }
  // Read-only, deliberately.
  //
  // This used to `await refreshHistory()` first. That call self-throttles to 12h, so it was
  // usually a no-op — but on the one page load an hour that opened the gate it ran the full
  // backfill *inside the request*: ten upstream feeds fetched in series, years of JSON
  // parsed, and thousands of rows written in ~55 batches, all before a byte was returned.
  // That is how a dashboard load exceeded the Worker's CPU limit.
  //
  // Nothing was lost by removing it. The cron in custom-worker.ts calls `refreshHistory()`
  // every five minutes against the same 12h gate, so the backfill still happens on exactly
  // the same schedule — just never on a reader's request. The Settings page keeps its
  // explicit "Rebuild history" button (`rebuildHistory` in app/actions.ts) for forcing one.
  // The `errors` this used to surface had no consumer; the field stays for shape stability.
  const { series, holdings } = await buildDaily();
  return NextResponse.json({ series, holdings, errors: [] });
}
