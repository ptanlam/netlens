import { connection } from "next/server";
import * as db from "@/lib/db";
import { DebtsManager } from "@/components/debts-manager";

export default async function DebtsPage() {
  await connection();
  const debts = db.listDebts();
  const payments = db.listDebtPayments();

  return (
    <div>
      <div className="mb-3.5">
        <div className="font-serif text-[22px] font-semibold tracking-[-0.01em]">Debts</div>
        <div className="mt-0.5 max-w-[820px] text-[13px] text-muted-foreground">
          Loans and credit accounts. <span className="italic">Fixed</span> charges interest on
          the original amount, <span className="italic">Flexible</span> recomputes on the
          remaining balance, and <span className="italic">Credit</span> flags any card you
          haven&apos;t paid this month. Record repayments with the wallet button.
        </div>
      </div>
      <DebtsManager debts={debts} payments={payments} />
    </div>
  );
}
