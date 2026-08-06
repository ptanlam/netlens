import { connection } from "next/server";
import * as db from "@/lib/db";
import { DebtsManager } from "@/components/debts-manager";

export default async function DebtsPage() {
  await connection();
  const [debts, payments] = await Promise.all([db.listDebts(), db.listDebtPayments()]);

  // The heading lives in <DebtsManager>: the design seats a page's primary action beside
  // its title, and "Add debt" is a client dialog, so the two have to share a component.
  // The clock is read once, here, and handed down. Interest accrues by the second, so a
  // client component reading its own `new Date()` renders a figure a rounding step away
  // from the server's — a hydration mismatch on every load. Same pattern as GoalWorld.nowMs.
  return <DebtsManager debts={debts} payments={payments} nowMs={db.nowMs()} />;
}
