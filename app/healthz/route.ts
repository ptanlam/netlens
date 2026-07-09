import { NextResponse } from "next/server";
import { allTransactions } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, transactions: allTransactions().length });
}
