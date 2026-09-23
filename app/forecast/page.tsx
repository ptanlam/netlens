import { connection } from "next/server";
import * as db from "@/lib/db";
import { ForecastView } from "@/components/forecast-view";
import {
  forecast, forecastEvents, forecastPace, MAX_HORIZON_MONTHS,
} from "@/lib/forecast";
import { addMonths } from "@/lib/savings";
import { buildPortfolioReturns, LOOKBACK_MONTHS } from "@/lib/volatility";

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
  // The current month is left out: its "close" is mid-month and would read as a short month.
  const monthStart = `${db.todayIso().slice(0, 7)}-01`;
  const [world, closes] = await Promise.all([
    db.buildGoalWorld(payload.portfolioTotal),
    db.monthEndCloses(
      payload.portfolio.map((h) => h.name),
      addMonths(monthStart, -LOOKBACK_MONTHS),
      monthStart,
    ),
  ]);
  // Only the derived monthly returns cross to the client, never the closes themselves.
  const portfolioReturns = buildPortfolioReturns(payload.portfolio, closes);

  const { pace, source } = forecastPace(world, goals);

  // The whole twenty years, computed once and sliced by the picker on the client. The walk is
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
      portfolioReturns={portfolioReturns}
    />
  );
}
