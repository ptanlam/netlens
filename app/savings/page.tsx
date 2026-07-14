import { connection } from "next/server";
import * as db from "@/lib/db";
import { SavingsManager } from "@/components/savings-manager";

export default async function SavingsPage() {
  await connection();
  const savings = db.listSavings();
  // Active sinking funds, so a deposit can be earmarked for one.
  const funds = db
    .listGoals()
    .filter((g) => g.metric === "fund")
    .map((g) => ({ id: g.id, name: g.name }));

  return (
    <div>
      <div className="mb-3.5">
        <div className="font-serif text-[22px] font-semibold tracking-[-0.01em]">Savings</div>
        <div className="mt-0.5 text-[13px] text-muted-foreground">
          Term deposits — principal, annual rate, and term. Value accrues to maturity
          (simple pays at maturity; compound accrues monthly).
        </div>
      </div>
      <SavingsManager savings={savings} funds={funds} />
    </div>
  );
}
