import { NextResponse } from "next/server";
import { buildDaily } from "@/lib/pnl";
import { refreshHistory } from "@/lib/prices";

export const dynamic = "force-dynamic";

export async function GET() {
  const [, errors] = await refreshHistory();
  const { series, holdings } = buildDaily();
  return NextResponse.json({ series, holdings, errors });
}
