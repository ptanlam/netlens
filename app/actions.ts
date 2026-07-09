"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import * as db from "@/lib/db";
import { refreshAll } from "@/lib/prices";
import { authToken, COOKIE_NAME } from "@/lib/auth";

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function revalidateAll() {
  for (const p of ["/", "/transactions", "/holdings", "/recurring"]) revalidatePath(p);
}

// ---------- transactions ----------

export async function addTx(fd: FormData) {
  const instrument = str(fd.get("instrument"));
  const amountRaw = num(fd.get("amount"));
  if (!instrument || amountRaw == null || amountRaw <= 0)
    return { ok: false, message: "Instrument and a positive amount are required." };
  const amount = fd.get("direction") === "sell" ? -Math.abs(amountRaw) : Math.abs(amountRaw);
  db.addTransaction(
    str(fd.get("date")) || db.todayIso(),
    str(fd.get("asset_type")) || "Funds",
    instrument, amount, num(fd.get("quantity")),
    str(fd.get("note")) || null,
  );
  revalidateAll();
  return { ok: true, message: "Transaction saved." };
}

export async function updateTx(id: number, fd: FormData) {
  if (!db.getTransaction(id)) return { ok: false, message: "Not found." };
  const instrument = str(fd.get("instrument"));
  const amountRaw = num(fd.get("amount"));
  if (!instrument || amountRaw == null || amountRaw <= 0)
    return { ok: false, message: "Instrument and a positive amount are required." };
  const amount = fd.get("direction") === "sell" ? -Math.abs(amountRaw) : Math.abs(amountRaw);
  db.updateTransaction(
    id,
    str(fd.get("date")) || db.todayIso(),
    str(fd.get("asset_type")) || "Funds",
    instrument, amount, num(fd.get("quantity")),
    str(fd.get("note")) || null,
  );
  revalidateAll();
  return { ok: true, message: "Transaction updated." };
}

export async function deleteTx(id: number) {
  db.deleteTransaction(id);
  revalidateAll();
  return { ok: true, message: "Transaction deleted." };
}

export async function setTxQty(id: number, quantity: number, addToHoldings: boolean) {
  const ok = db.setTransactionQuantity(id, quantity, addToHoldings);
  revalidateAll();
  return { ok, message: ok ? "Units saved." : "Not found." };
}

// ---------- holdings ----------

export async function saveHoldings(fd: FormData) {
  const rows = Number(fd.get("rows") ?? 0);
  for (let i = 0; i < rows; i++) {
    const name = str(fd.get(`inst_${i}`));
    if (!name) continue;
    db.updateInstrumentFields(
      name,
      str(fd.get(`type_${i}`)) || "Funds",
      str(fd.get(`source_${i}`)) || "manual",
      str(fd.get(`symbol_${i}`)) || null,
      num(fd.get(`qty_${i}`)),
      num(fd.get(`manual_${i}`)),
    );
  }
  revalidateAll();
  return { ok: true, message: "Holdings saved." };
}

export async function refreshPrices() {
  const [updated, errors] = await refreshAll();
  revalidateAll();
  return {
    ok: errors.length === 0,
    message: `Updated ${updated} price(s).` + (errors.length ? ` ${errors.length} failed.` : ""),
  };
}

// ---------- recurring rules ----------

export async function addRule(fd: FormData) {
  const instrument = str(fd.get("instrument"));
  const amount = num(fd.get("amount"));
  if (!instrument || amount == null || amount <= 0)
    return { ok: false, message: "Instrument and a positive amount are required." };
  const freq = fd.get("freq") === "monthly" ? "monthly" : "weekly";
  db.addRecurring(instrument, str(fd.get("asset_type")) || "Funds", amount, freq,
    str(fd.get("start_date")) || db.todayIso(), str(fd.get("note")) || null);
  const created = db.materializeRecurring();
  revalidateAll();
  return { ok: true, message: created ? `Rule added — ${created} transaction(s) created.` : "Rule added." };
}

export async function updateRule(id: number, fd: FormData) {
  const instrument = str(fd.get("instrument"));
  const amount = num(fd.get("amount"));
  if (!instrument || amount == null || amount <= 0)
    return { ok: false, message: "Instrument and a positive amount are required." };
  const freq = fd.get("freq") === "monthly" ? "monthly" : "weekly";
  db.updateRecurring(id, instrument, str(fd.get("asset_type")) || "Funds", amount, freq,
    str(fd.get("start_date")) || db.todayIso(), str(fd.get("note")) || null);
  revalidateAll();
  return { ok: true, message: "Rule updated." };
}

export async function toggleRule(id: number) {
  db.toggleRecurring(id);
  revalidateAll();
  return { ok: true, message: "Rule updated." };
}

export async function deleteRule(id: number) {
  db.deleteRecurring(id);
  revalidateAll();
  return { ok: true, message: "Rule deleted." };
}

// ---------- auth ----------

export async function login(fd: FormData) {
  const password = str(fd.get("password"));
  const expected = process.env.APP_PASSWORD;
  if (!expected) redirect("/");
  if (password !== expected) return { ok: false, message: "Wrong password, try again." };
  const jar = await cookies();
  jar.set(COOKIE_NAME, authToken(expected), {
    httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 90, path: "/",
  });
  redirect("/");
}
