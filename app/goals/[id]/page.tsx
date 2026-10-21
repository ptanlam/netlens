import { connection } from "next/server";
import { notFound } from "next/navigation";
import * as db from "@/lib/db";
import { goalPropertyKey } from "@/lib/types";
import { RealEstateDetail } from "@/components/real-estate-detail";

/** An apartment goal's price estimate: the plot page, on the goal's own location and comps
 *  (`goal:<id>`, migration 0013). */
export default async function ApartmentGoalPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const goal = await db.getGoal(Number((await params).id));
  if (!goal || goal.down_payment_pct == null) notFound();
  const key = goalPropertyKey(goal.id);
  const [property, comps, index] = await Promise.all([
    db.getProperty(key), db.listComps(key), db.listPropertyIndex(key),
  ]);

  return (
    <RealEstateDetail
      holding={{ name: key, value: 0 }}
      property={property ?? null}
      comps={comps}
      index={index}
      anchor={null}
      valuations={[]}
      today={db.todayIso()}
      goal={{ title: goal.name, downPct: goal.down_payment_pct }}
    />
  );
}
