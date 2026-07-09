import { connection } from "next/server";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import * as db from "@/lib/db";
import { fmtVND } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { DashboardCharts } from "@/components/dashboard-charts";
import { NetWorthPanel } from "@/components/net-worth";
import { RefreshPricesButton } from "@/components/refresh-prices";
import { cn } from "@/lib/utils";
import { summarize, currentValue } from "@/lib/savings";

export default async function Dashboard() {
  await connection();
  db.materializeRecurring();
  const payload = db.buildPayload();
  const pending = db.pendingFundUnits();

  const savingsValue = summarize(db.listSavings()).currentValue;
  const debtsValue = db.listDebts().reduce((a, d) => a + currentValue(d), 0);

  const pnlPct = payload.investedTotal
    ? (payload.pnl / payload.investedTotal) * 100
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <NetWorthPanel
        investments={payload.portfolioTotal}
        savings={savingsValue}
        debts={debtsValue}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent>
            <div className="text-sm text-muted-foreground">Portfolio value</div>
            <div className="mt-1 text-lg font-semibold tracking-tight tabular-nums sm:text-2xl lg:text-3xl">
              {fmtVND(payload.portfolioTotal)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-sm text-muted-foreground">Total invested</div>
            <div className="mt-1 text-lg font-semibold tracking-tight tabular-nums sm:text-2xl lg:text-3xl">
              {fmtVND(payload.investedTotal)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-sm text-muted-foreground">Unrealized P&L</div>
            <div
              className={cn(
                "mt-1 text-lg font-semibold tracking-tight tabular-nums sm:text-2xl lg:text-3xl",
                payload.pnl >= 0
                  ? "text-(--chart-positive)"
                  : "text-(--chart-negative)",
              )}
            >
              {payload.pnl >= 0 ? "+" : ""}
              {fmtVND(payload.pnl)}
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {pnlPct >= 0 ? "+" : ""}
              {pnlPct.toFixed(1)}% of invested
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex h-full flex-col justify-between gap-2">
            <div>
              <div className="text-sm text-muted-foreground">Live prices</div>
              <div className="mt-1 text-sm">
                {payload.pricesAsOf
                  ? `as of ${payload.pricesAsOf.replace("T", " ")}`
                  : "never fetched"}
              </div>
            </div>
            <RefreshPricesButton />
          </CardContent>
        </Card>
      </div>

      {pending.length > 0 && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>
            {pending.length} fund purchase{pending.length > 1 ? "s" : ""} awaiting
            unit confirmation
          </AlertTitle>
          <AlertDescription>
            <Link href="/transactions" className="underline underline-offset-2">
              Enter the confirmed units on the transactions page
            </Link>{" "}
            so live valuation stays accurate.
          </AlertDescription>
        </Alert>
      )}

      <DashboardCharts payload={payload} />
    </div>
  );
}
