import { connection } from "next/server";
import * as db from "@/lib/db";
import { SavingsManager } from "@/components/savings-manager";

export default async function SavingsPage() {
  await connection();
  const [savings, goals] = await Promise.all([db.listSavings(), db.listGoals()]);
  // Active sinking funds, so a deposit can be earmarked for one.
  const funds = goals
    .filter((g) => g.metric === "fund")
    .map((g) => ({ id: g.id, name: g.name }));

  // The heading lives in <SavingsManager>: the design seats a page's primary action beside
  // its title, and "New deposit" is a client dialog, so the two have to share a component.
  // Read once here, not in the client component — see the note in app/debts/page.tsx.
  return <SavingsManager savings={savings} funds={funds} nowMs={db.nowMs()} />;
}
