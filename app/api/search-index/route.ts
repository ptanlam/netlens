import { NextResponse } from "next/server";
import * as db from "@/lib/db";

export const dynamic = "force-dynamic";

/** One jumpable thing: a page, a holding, a deposit, a loan, a goal. */
export interface SearchItem {
  label: string;
  /** What kind of thing it is — shown as the row's tag. */
  kind: string;
  href: string;
}

/**
 * Everything the header search can jump to, as one flat list.
 *
 * The whole index is sent at once and filtered in the browser: this is a single-user app
 * whose index is a few hundred short strings, so a query-per-keystroke round trip to D1
 * would cost more than the payload it saves. The route is called once, on the first focus
 * of the search box, and cached in the client for the life of the page.
 */
export async function GET() {
  const [instruments, savings, debts, goals] = await Promise.all([
    db.listInstruments(),
    db.listSavings(),
    db.listDebts(),
    db.listGoals(),
  ]);

  const items: SearchItem[] = [
    { label: "Dashboard", kind: "Page", href: "/" },
    { label: "Investments", kind: "Page", href: "/investments" },
    { label: "Savings", kind: "Page", href: "/savings" },
    { label: "Debts", kind: "Page", href: "/debts" },
    { label: "Goals", kind: "Page", href: "/goals" },
    { label: "Transactions", kind: "Page", href: "/transactions" },
    { label: "Settings", kind: "Page", href: "/settings" },
    ...instruments.map((i) => ({ label: i.name, kind: i.asset_type, href: "/investments" })),
    ...savings.map((s) => ({
      label: s.bank ?? "Term deposit",
      kind: "Deposit",
      href: "/savings",
    })),
    ...debts.map((d) => ({
      label: d.lender ?? (d.kind === "credit" ? "Credit card" : "Loan"),
      kind: "Debt",
      href: "/debts",
    })),
    ...goals.map((g) => ({ label: g.name, kind: "Goal", href: "/goals" })),
  ];

  return NextResponse.json({ items });
}
