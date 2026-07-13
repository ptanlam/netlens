import { NextResponse } from "next/server";
import { buildDaily } from "@/lib/pnl";
import { refreshHistory } from "@/lib/prices";

export const dynamic = "force-dynamic";

/** `?today=1` returns just the latest day and skips `refreshHistory()`. A price refresh
 *  can only move today's point (it stamps today into `price_history`), so the dashboard
 *  polls this instead of re-pulling every instrument's daily candles on every tick. */
export async function GET(req: Request) {
  const todayOnly = new URL(req.url).searchParams.has("today");
  const errors = todayOnly ? [] : (await refreshHistory())[1];
  const { series, holdings } = buildDaily();
  return NextResponse.json(
    todayOnly
      ? { series: series.slice(-1), holdings: holdings.slice(-1), errors }
      : { series, holdings, errors },
  );
}
