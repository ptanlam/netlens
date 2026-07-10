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
  for (const p of ["/", "/investments", "/savings", "/debts"]) revalidatePath(p);
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

// ---------- savings (term deposits) ----------

type ParsedSaving = {
  bank: string | null;
  principal: number;
  rate: number;
  start_date: string;
  term_months: number;
  interest_type: "simple" | "compound";
  note: string | null;
};

function parseSaving(fd: FormData): { ok: true; value: ParsedSaving } | { ok: false; message: string } {
  const principal = num(fd.get("principal"));
  const rate = num(fd.get("rate"));
  const term = num(fd.get("term_months"));
  if (principal == null || principal <= 0)
    return { ok: false, message: "A positive principal is required." };
  if (rate == null || rate < 0)
    return { ok: false, message: "A valid interest rate is required." };
  if (term == null || term <= 0)
    return { ok: false, message: "A positive term (months) is required." };
  return {
    ok: true,
    value: {
      bank: str(fd.get("bank")) || null,
      principal,
      rate,
      start_date: str(fd.get("start_date")) || db.todayIso(),
      term_months: term,
      interest_type: fd.get("interest_type") === "compound" ? "compound" : "simple",
      note: str(fd.get("note")) || null,
    },
  };
}

export async function addSaving(fd: FormData) {
  const p = parseSaving(fd);
  if (!p.ok) return { ok: false, message: p.message };
  const s = p.value;
  db.addSaving(s.bank, s.principal, s.rate, s.start_date, s.term_months, s.interest_type, s.note);
  revalidateAll();
  return { ok: true, message: "Deposit saved." };
}

export async function updateSaving(id: number, fd: FormData) {
  if (!db.getSaving(id)) return { ok: false, message: "Not found." };
  const p = parseSaving(fd);
  if (!p.ok) return { ok: false, message: p.message };
  const s = p.value;
  db.updateSaving(id, s.bank, s.principal, s.rate, s.start_date, s.term_months, s.interest_type, s.note);
  revalidateAll();
  return { ok: true, message: "Deposit updated." };
}

export async function deleteSaving(id: number) {
  db.deleteSaving(id);
  revalidateAll();
  return { ok: true, message: "Deposit deleted." };
}

// ---------- debts (loans) ----------

type ParsedDebt = {
  lender: string | null;
  principal: number;
  rate: number;
  start_date: string;
  term_months: number;
  interest_type: "simple" | "compound";
  kind: "fixed" | "flexible" | "credit";
  monthly_payment: number | null;
  note: string | null;
};

function parseDebt(fd: FormData): { ok: true; value: ParsedDebt } | { ok: false; message: string } {
  const principal = num(fd.get("principal"));
  const rate = num(fd.get("rate"));
  const kindRaw = str(fd.get("kind"));
  const kind = kindRaw === "flexible" ? "flexible" : kindRaw === "credit" ? "credit" : "fixed";
  const openEnded = kind === "credit";
  const term = openEnded ? 0 : num(fd.get("term_months"));
  const monthly = num(fd.get("monthly_payment"));
  if (principal == null || principal <= 0)
    return { ok: false, message: "A positive principal is required." };
  if (rate == null || rate < 0)
    return { ok: false, message: "A valid interest rate is required." };
  if (!openEnded && (term == null || term <= 0))
    return { ok: false, message: "A positive term (months) is required for a fixed/flexible debt." };
  if (openEnded && (monthly == null || monthly <= 0))
    return { ok: false, message: "A monthly payment amount is required for a credit debt." };
  return {
    ok: true,
    value: {
      lender: str(fd.get("lender")) || null,
      principal,
      rate,
      start_date: str(fd.get("start_date")) || db.todayIso(),
      term_months: term ?? 0,
      interest_type: fd.get("interest_type") === "compound" ? "compound" : "simple",
      kind,
      monthly_payment: openEnded ? monthly : null,
      note: str(fd.get("note")) || null,
    },
  };
}

export async function addDebt(fd: FormData) {
  const p = parseDebt(fd);
  if (!p.ok) return { ok: false, message: p.message };
  const d = p.value;
  db.addDebt(d.lender, d.principal, d.rate, d.start_date, d.term_months, d.interest_type, d.kind, d.monthly_payment, d.note);
  revalidateAll();
  return { ok: true, message: "Debt saved." };
}

export async function updateDebt(id: number, fd: FormData) {
  if (!db.getDebt(id)) return { ok: false, message: "Not found." };
  const p = parseDebt(fd);
  if (!p.ok) return { ok: false, message: p.message };
  const d = p.value;
  db.updateDebt(id, d.lender, d.principal, d.rate, d.start_date, d.term_months, d.interest_type, d.kind, d.monthly_payment, d.note);
  revalidateAll();
  return { ok: true, message: "Debt updated." };
}

export async function deleteDebt(id: number) {
  db.deleteDebt(id);
  revalidateAll();
  return { ok: true, message: "Debt deleted." };
}

export async function addDebtPayment(debtId: number, fd: FormData) {
  if (!db.getDebt(debtId)) return { ok: false, message: "Debt not found." };
  const amount = num(fd.get("amount"));
  if (amount == null || amount <= 0)
    return { ok: false, message: "A positive payment amount is required." };
  db.addDebtPayment(debtId, str(fd.get("date")) || db.todayIso(), amount, str(fd.get("note")) || null);
  revalidateAll();
  return { ok: true, message: "Payment recorded." };
}

export async function updateDebtPayment(id: number, fd: FormData) {
  const amount = num(fd.get("amount"));
  if (amount == null || amount <= 0)
    return { ok: false, message: "A positive payment amount is required." };
  const ok = db.updateDebtPayment(id, str(fd.get("date")) || db.todayIso(), amount, str(fd.get("note")) || null);
  revalidateAll();
  return { ok, message: ok ? "Payment updated." : "Payment not found." };
}

export async function deleteDebtPayment(id: number) {
  db.deleteDebtPayment(id);
  revalidateAll();
  return { ok: true, message: "Payment deleted." };
}

// ---------- holdings ----------

export async function addHolding(fd: FormData) {
  const name = str(fd.get("name"));
  if (!name) return { ok: false, message: "A holding name is required." };
  if (db.getInstrument(name)) return { ok: false, message: `"${name}" already exists.` };
  db.addInstrument(
    name,
    str(fd.get("asset_type")) || "Funds",
    str(fd.get("price_source")) || "manual",
    str(fd.get("symbol")) || null,
    num(fd.get("quantity")),
    num(fd.get("manual_value")),
  );
  revalidateAll();
  return { ok: true, message: "Holding added." };
}

export async function updateHolding(name: string, fd: FormData) {
  if (!db.getInstrument(name)) return { ok: false, message: "Holding not found." };
  db.updateInstrumentFields(
    name,
    str(fd.get("asset_type")) || "Funds",
    str(fd.get("price_source")) || "manual",
    str(fd.get("symbol")) || null,
    num(fd.get("quantity")),
    num(fd.get("manual_value")),
  );
  revalidateAll();
  return { ok: true, message: "Holding updated." };
}

export async function deleteHolding(name: string) {
  if (db.instrumentInUse(name))
    return { ok: false, message: "Remove its transactions and recurring rules first." };
  db.deleteInstrument(name);
  revalidateAll();
  return { ok: true, message: "Holding deleted." };
}

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
