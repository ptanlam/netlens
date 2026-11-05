import { connection } from "next/server";
import * as db from "@/lib/db";
import { StreakSettings } from "@/components/streak-settings";

export default async function StreakSettingsPage() {
  await connection();
  const [setting, planned, goals] = await Promise.all([
    db.getStreakCommitment(), db.plannedMonthly(), db.listGoals(),
  ]);
  // What each source comes to today, so every option says what picking it would mean.
  // The same sum `commitment()` takes over the goals the dashboard hands it.
  const goalPlans = goals.reduce((a, g) => a + (g.monthly_plan ?? 0), 0);
  return <StreakSettings setting={setting} recurring={planned} goalPlans={goalPlans} />;
}
