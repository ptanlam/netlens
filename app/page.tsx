import { connection } from "next/server";
import Link from "next/link";
import { Activity, Landmark, TrendingDown, TrendingUp, TriangleAlert, Wallet } from "lucide-react";
import * as db from "@/lib/db";
import { fmtVND } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DashboardCharts } from "@/components/dashboard-charts";
import { NetWorthPanel } from "@/components/net-worth";
import { RefreshPricesControls } from "@/components/refresh-prices";
import { StatCard } from "@/components/stat-card";
import { summarize, debtOwed, type Payment } from "@/lib/savings";

export default async function Dashboard() {
  await connection();
  db.materializeRecurring();
  const payload = db.buildPayload();
  const pending = db.pendingFundUnits();

  const savingsValue = summarize(db.listSavings()).currentValue;
  const debtPayments = db.listDebtPayments();
  const paymentsByDebt = new Map<number, Payment[]>();
  for (const p of debtPayments) {
    const list = paymentsByDebt.get(p.debt_id) ?? [];
    list.push(p);
    paymentsByDebt.set(p.debt_id, list);
  }
  const debtsValue = db.listDebts().reduce((a, d) => a + debtOwed(d, paymentsByDebt.get(d.id) ?? []), 0);

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
        <StatCard
          tone="violet"
          icon={Wallet}
          label="Portfolio value"
          value={fmtVND(payload.portfolioTotal)}
        />
        <StatCard
          tone="sky"
          icon={Landmark}
          label="Total invested"
          value={fmtVND(payload.investedTotal)}
        />
        <StatCard
          tone={payload.pnl >= 0 ? "emerald" : "rose"}
          icon={payload.pnl >= 0 ? TrendingUp : TrendingDown}
          label="Unrealized P&L"
          value={`${payload.pnl >= 0 ? "+" : ""}${fmtVND(payload.pnl)}`}
          valueClassName={payload.pnl >= 0 ? "text-(--chart-positive)" : "text-(--chart-negative)"}
          sub={`${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% of invested`}
        />
        <StatCard
          tone="amber"
          icon={Activity}
          label="Live prices"
          sub={payload.pricesAsOf ? `as of ${payload.pricesAsOf.replace("T", " ")}` : "never fetched"}
        >
          <RefreshPricesControls showTimestamp={false} />
        </StatCard>
      </div>

      {pending.length > 0 && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>
            {pending.length} fund purchase{pending.length > 1 ? "s" : ""} awaiting
            unit confirmation
          </AlertTitle>
          <AlertDescription>
            <Link href="/investments" className="underline underline-offset-2">
              Enter the confirmed units on the investment page
            </Link>{" "}
            so live valuation stays accurate.
          </AlertDescription>
        </Alert>
      )}

      <DashboardCharts payload={payload} />
    </div>
  );
}
