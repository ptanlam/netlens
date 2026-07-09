import { NextResponse } from "next/server";
import { buildDailySeries } from "@/lib/pnl";
import { refreshHistory } from "@/lib/prices";

export const dynamic = "force-dynamic";

export async function GET() {
  const [, errors] = await refreshHistory();
  const series = buildDailySeries();
  return NextResponse.json({ series, errors });
}
