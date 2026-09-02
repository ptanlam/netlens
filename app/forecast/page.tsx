import { connection } from "next/server";
import * as db from "@/lib/db";
import { ForecastView } from "@/components/forecast-view";
import {
  forecast, forecastEvents, forecastPace, MAX_HORIZON_MONTHS,
} from "@/lib/forecast";

export default async function ForecastPage() {
  await connection();
  // Must land before anything reads transactions — it inserts the due ones.
  await db.materializeRecurring();

  // Two waves, like the dashboard: `buildGoalWorld` needs the portfolio total, and
  // everything else is independent. The deposits and debts are the same rows the world
  // carries, fetched alongside it rather than out of it — the world narrows them to the
  // accruing shape, and an event needs the bank's and the lender's names.
  const [payload, goals, subscriptions, deposits, debts] = await Promise.all([
    db.buildPayload(),
    db.listGoals(),
    db.listSubscriptions(),
    db.listSavings(),
    db.listDebts(),
  ]);
  const world = await db.buildGoalWorld(payload.portfolioTotal);

  const { pace, source } = forecastPace(world, goals);

  // The whole five years, computed once and sliced by the picker on the client. The walk is
  // pure and the payload is sixty rows either way, so a horizon change costs no round trip.
  const points = forecast(world, pace, MAX_HORIZON_MONTHS);
  const events = forecastEvents({
    world, deposits, debts, goals, subscriptions, months: MAX_HORIZON_MONTHS,
  });

  return (
    <ForecastView
      points={points}
      events={events}
      pace={pace}
      paceSource={source}
      today={world.today}
    />
  );
}
