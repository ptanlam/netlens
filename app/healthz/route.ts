import { NextResponse } from "next/server";
import { allTransactions } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await allTransactions();
  return NextResponse.json({ ok: true, transactions: rows.length });
}
