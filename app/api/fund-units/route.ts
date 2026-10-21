import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import { setTxQty } from "@/app/actions";

export const dynamic = "force-dynamic";

/**
 * Confirm the units of a fund buy that is awaiting them — the panel on /transactions, for a
 * machine. Called by the Gmail Apps Script (`scripts/gmail-fund-units.gs`) when a fund's
 * confirmation email lands.
 *
 * Authentication is Cloudflare Access, as for every other path: this route has its own Access
 * application whose only policy is a service token, so that token reaches this path and
 * nothing else (docs/CLOUDFLARE.md#the-fund-units-api).
 *
 * Body: `{ instrument, quantity, amount?, date? }`. The buy is the oldest awaiting one of
 * that instrument (and amount and buy date, when given). Confirmations arrive in the order the
 * buys were made, so a weekly recurring buy pairs up first-in, first-out. But that means
 * sending the same confirmation twice without `date` confirms the *next* buy as well, so the
 * caller must remember what it sent (the Gmail script does). With `date`, a buy already
 * confirmed is never matched, and a repeat is just a 404.
 */
export async function POST(request: Request) {
  // JSON only: a cross-site form post can't send it without a CORS preflight nothing answers.
  if (!request.headers.get("content-type")?.includes("application/json"))
    return NextResponse.json({ error: "Send application/json." }, { status: 415 });

  const body = (await request.json().catch(() => null)) as
    | { instrument?: unknown; quantity?: unknown; amount?: unknown; date?: unknown; heartbeat?: unknown; unread?: unknown }
    | null;

  // The script's "I ran" at the end of every run, so the dashboard can tell when it
  // stopped, or keeps meeting emails it can't read (`unread`).
  if (body?.heartbeat === true) {
    const unread = Number(body.unread) || 0;
    await db.recordJob("gmail", null, unread > 0 ? `${unread} confirmation email${unread > 1 ? "s" : ""} it couldn't read` : null);
    return NextResponse.json({ ok: true });
  }
  const instrument = typeof body?.instrument === "string" ? body.instrument.trim() : "";
  const quantity = Number(body?.quantity);
  const amount = body?.amount == null ? null : Number(body.amount);
  const date = body?.date == null ? null : String(body.date);
  if (
    !instrument || !Number.isFinite(quantity) || quantity <= 0 ||
    (amount != null && !(amount > 0)) || (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(date))
  )
    return NextResponse.json(
      { error: "Expected { instrument: string, quantity: number > 0, amount?: number > 0, date?: YYYY-MM-DD }." },
      { status: 400 },
    );

  // A recurring buy only becomes a row when something materialises it — usually a page
  // visit — and its confirmation email can easily arrive before you've opened the app.
  await db.materializeRecurring();
  const matches = (await db.pendingFundUnits()).filter(
    (tx) => tx.instrument.toLowerCase() === instrument.toLowerCase() && (amount == null || tx.amount === amount) && (date == null || tx.date === date),
  );
  // `pendingFundUnits` is newest first, so the oldest is last.
  const tx = matches.at(-1);
  if (!tx)
    return NextResponse.json({ error: `No buy of ${instrument} is awaiting units.` }, { status: 404 });

  // The same default the panel's "add to holding" box starts with.
  const inst = await db.getInstrument(tx.instrument);
  const res = await setTxQty(tx.id, quantity, inst?.quantity != null);
  if (!res.ok) return NextResponse.json({ error: res.message }, { status: 409 });

  return NextResponse.json({
    ok: true,
    transaction: { id: tx.id, instrument: tx.instrument, date: tx.date, amount: tx.amount, quantity },
    stillAwaiting: matches.length - 1,
  });
}
