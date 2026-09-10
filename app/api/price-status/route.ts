import { NextResponse } from "next/server";
import * as db from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * What the server is doing about prices: the account's cadence, and when a refresh last
 * ran. Two columns of `meta` in one query.
 *
 * This is the whole of the client's involvement in price refreshing now. The browser used
 * to *drive* it — an open-time pull plus a timer, each firing the `refreshPrices` server
 * action, which went out to CoinGecko / Yahoo / fmarket. That put the schedule in whichever
 * tab happened to be open and spent a round of upstream calls on every visit. The cron
 * fetches now; a page only asks whether the stamp has moved, and re-renders if it has.
 *
 * Deliberately uncached — it is read *because* it changes, and a cached copy would report
 * prices as stale exactly when they had just been refreshed.
 */
export async function GET() {
  return NextResponse.json(await db.priceStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
