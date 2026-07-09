import { allTransactions } from "@/lib/db";

export const dynamic = "force-dynamic";

function csvCell(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const rows = allTransactions();
  const header = "id,date,asset_type,instrument,amount,quantity,note,created_at";
  const lines = rows.map((t) =>
    [t.id, t.date, t.asset_type, t.instrument, t.amount, t.quantity, t.note, t.created_at]
      .map(csvCell)
      .join(","),
  );
  // UTF-8 BOM so Excel/Numbers opens it cleanly
  const body = "﻿" + [header, ...lines].join("\r\n") + "\r\n";
  const today = new Date().toLocaleDateString("sv-SE");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="investment-transactions-${today}.csv"`,
    },
  });
}
