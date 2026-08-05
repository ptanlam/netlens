import { NextResponse } from "next/server";
import { buildDaily, buildLatest } from "@/lib/pnl";
import { refreshHistory } from "@/lib/prices";

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
