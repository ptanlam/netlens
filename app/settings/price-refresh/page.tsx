import { connection } from "next/server";
import * as db from "@/lib/db";
import { PriceScheduleSettings } from "@/components/price-schedule-settings";

export default async function PriceRefreshPage() {
  await connection();
  return <PriceScheduleSettings schedule={await db.getPriceSchedule()} />;
}
