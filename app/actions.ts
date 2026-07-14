"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import * as db from "@/lib/db";
import { refreshAll, testPriceSource as runPriceSourceTest } from "@/lib/prices";
import { authToken, COOKIE_NAME } from "@/lib/auth";
import { fmtVND } from "@/lib/format";
import { GOAL_METRICS, type GoalMetric } from "@/lib/types";

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function revalidateAll() {
  for (const p of ["/", "/investments", "/savings", "/debts", "/goals", "/settings/price-sources"])
    revalidatePath(p);
}

// ---------- transactions ----------

/** The form always submits positive numbers and a separate buy/sell direction.
 *  BOTH amount and quantity must carry the sign: `lib/pnl.ts` reads `tx.quantity`
 *  straight through as signed units, so an unsigned sell quantity would be counted
 *  as *buying* those units. */
function signedTx(fd: FormData): { amount: number; quantity: number | null } | null {
  const amountRaw = num(fd.get("amount"));
  if (amountRaw == null || amountRaw <= 0) return null;
  const sell = fd.get("direction") === "sell";
  const qtyRaw = num(fd.get("quantity"));
  return {
    amount: sell ? -Math.abs(amountRaw) : Math.abs(amountRaw),
    quantity: qtyRaw == null ? null : sell ? -Math.abs(qtyRaw) : Math.abs(qtyRaw),
  };
}

export async function addTx(fd: FormData) {
  const instrument = str(fd.get("instrument"));
  const signed = signedTx(fd);
  if (!instrument || !signed)
    return { ok: false, message: "Instrument and a positive amount are required." };
  db.addTransaction(
    str(fd.get("date")) || db.todayIso(),
    str(fd.get("asset_type")) || "Funds",
    instrument, signed.amount, signed.quantity,
    str(fd.get("note")) || null,
  );
  revalidateAll();
  return { ok: true, message: "Transaction saved." };
}

export async function updateTx(id: number, fd: FormData) {
  if (!db.getTransaction(id)) return { ok: false, message: "Not found." };
  const instrument = str(fd.get("instrument"));
  const signed = signedTx(fd);
  if (!instrument || !signed)
    return { ok: false, message: "Instrument and a positive amount are required." };
  db.updateTransaction(
    id,
    str(fd.get("date")) || db.todayIso(),
    str(fd.get("asset_type")) || "Funds",
    instrument, signed.amount, signed.quantity,
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
  /** Earmarked for a sinking fund, or null for an ordinary deposit. */
  goal_id: number | null;
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
      // "" (the None option) means the deposit isn't earmarked for anything.
      goal_id: num(fd.get("goal_id")),
      note: str(fd.get("note")) || null,
    },
  };
}

export async function addSaving(fd: FormData) {
  const p = parseSaving(fd);
  if (!p.ok) return { ok: false, message: p.message };
  const s = p.value;
  db.addSaving(s.bank, s.principal, s.rate, s.start_date, s.term_months, s.interest_type, s.goal_id, s.note);
  revalidateAll();
  return { ok: true, message: "Deposit saved." };
}

export async function updateSaving(id: number, fd: FormData) {
  if (!db.getSaving(id)) return { ok: false, message: "Not found." };
  const p = parseSaving(fd);
  if (!p.ok) return { ok: false, message: p.message };
  const s = p.value;
  db.updateSaving(id, s.bank, s.principal, s.rate, s.start_date, s.term_months, s.interest_type, s.goal_id, s.note);
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

// ---------- goals ----------

type ParsedGoal = {
  name: string;
  metric: GoalMetric;
  target: number;
  baseline: number;
  monthly_plan: number | null;
  target_date: string | null;
  note: string | null;
};

function parseGoal(fd: FormData): { ok: true; value: ParsedGoal } | { ok: false; message: string } {
  const name = str(fd.get("name"));
  const metricRaw = str(fd.get("metric")) as GoalMetric;
  const metric = GOAL_METRICS.includes(metricRaw) ? metricRaw : "net_worth";
  const target = num(fd.get("target"));
  const isFund = metric === "fund";
  // A fund starts empty by definition — its balance IS its progress, so there's nothing
  // to measure from and no baseline field on the form.
  const baseline = isFund ? 0 : (num(fd.get("baseline")) ?? 0);
  const plan = num(fd.get("monthly_plan"));
  if (!name) return { ok: false, message: "A goal name is required." };
  if (target == null || target <= 0)
    return { ok: false, message: "A target amount is required." };
  // A debt goal counts DOWN from the baseline, so the two can't be the same number —
  // there'd be no distance to cover and the bar could never move.
  if (metric === "debts" && baseline <= target)
    return { ok: false, message: "For a debt goal the starting balance must be above the target." };
  if (metric !== "debts" && baseline >= target)
    return { ok: false, message: "The target must be above the starting point." };
  return {
    ok: true,
    value: {
      name,
      metric,
      target,
      baseline,
      monthly_plan: plan != null && plan > 0 ? plan : null,
      target_date: str(fd.get("target_date")) || null,
      note: str(fd.get("note")) || null,
    },
  };
}

export async function addGoal(fd: FormData) {
  const p = parseGoal(fd);
  if (!p.ok) return { ok: false, message: p.message };
  const g = p.value;
  db.addGoal(g.name, g.metric, g.target, g.baseline, g.monthly_plan, g.target_date, g.note);
  revalidateAll();
  return { ok: true, message: "Goal saved." };
}

export async function updateGoal(id: number, fd: FormData) {
  const existing = db.getGoal(id);
  if (!existing) return { ok: false, message: "Not found." };
  const p = parseGoal(fd);
  if (!p.ok) return { ok: false, message: p.message };
  const g = p.value;
  // Switching a fund to another metric would strand its ledger — the money would vanish
  // from net worth while its rows sat in the table. Renaming and re-targeting are fine.
  if (existing.metric === "fund" && g.metric !== "fund" && db.listGoalContributions(id).length > 0)
    return {
      ok: false,
      message: "This fund holds money. Withdraw it (or mark it as bought) before changing what it tracks.",
    };
  db.updateGoal(id, g.name, g.metric, g.target, g.baseline, g.monthly_plan, g.target_date, g.note);
  revalidateAll();
  return { ok: true, message: "Goal updated." };
}

/** Put money into a sinking fund (or take it out — a negative amount is a withdrawal). */
export async function addGoalContribution(goalId: number, fd: FormData) {
  const goal = db.getGoal(goalId);
  if (!goal) return { ok: false, message: "Goal not found." };
  if (goal.metric !== "fund")
    return { ok: false, message: "Only a sinking fund holds money." };
  const amount = num(fd.get("amount"));
  if (amount == null || amount === 0)
    return { ok: false, message: "An amount is required." };
  const withdraw = str(fd.get("direction")) === "withdraw";
  const signed = withdraw ? -Math.abs(amount) : Math.abs(amount);
  db.addGoalContribution(goalId, str(fd.get("date")) || db.todayIso(), signed, str(fd.get("note")) || null);
  revalidateAll();
  return { ok: true, message: withdraw ? "Withdrawal recorded." : "Money added." };
}

export async function deleteGoalContribution(id: number) {
  db.deleteGoalContribution(id);
  revalidateAll();
  return { ok: true, message: "Entry deleted." };
}

/**
 * You bought the thing: drain the cash pot in one withdrawal and archive the goal.
 *
 * Earmarked deposits are only un-earmarked, never deleted. A deposit is real money in a
 * real bank until you actually withdraw it — Netlens can't cash it out for you, and
 * deleting the row here would erase it from net worth while the bank still holds it. Once
 * you've broken the deposit for real, delete it on the Savings page.
 */
export async function spendGoalFund(goalId: number) {
  const goal = db.getGoal(goalId);
  if (!goal) return { ok: false, message: "Goal not found." };
  if (goal.metric !== "fund") return { ok: false, message: "Only a sinking fund holds money." };

  const cash = db.fundCash(goalId);
  const deposits = db.savingsByGoal()[goalId] ?? [];
  if (cash <= 0 && deposits.length === 0) return { ok: false, message: "This fund is empty." };

  if (cash > 0) db.addGoalContribution(goalId, db.todayIso(), -Math.round(cash), `Bought: ${goal.name}`);
  db.unlinkGoalSavings(goalId);
  db.setGoalArchived(goalId, true);
  revalidateAll();

  const parts = [cash > 0 ? `${fmtVND(cash)} in cash spent` : null,
    deposits.length > 0
      ? `${deposits.length} deposit${deposits.length === 1 ? "" : "s"} released — delete ${deposits.length === 1 ? "it" : "them"} on Savings once withdrawn`
      : null].filter(Boolean);
  return { ok: true, message: `${parts.join(" · ")} — goal archived.` };
}

/** Move a goal one place up or down your ranking. */
export async function moveGoal(id: number, direction: "up" | "down") {
  const moved = db.moveGoal(id, direction);
  if (!moved) return { ok: false, message: "Already at the end." };
  revalidateAll();
  return { ok: true, message: "" };
}

export async function archiveGoal(id: number, archived: boolean) {
  if (!db.getGoal(id)) return { ok: false, message: "Not found." };
  db.setGoalArchived(id, archived);
  revalidateAll();
  return { ok: true, message: archived ? "Goal archived." : "Goal restored." };
}

export async function deleteGoal(id: number) {
  db.deleteGoal(id);
  revalidateAll();
  return { ok: true, message: "Goal deleted." };
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

// ---------- price sources ----------

/** Build a source config from the form fields, minus key validation (which only the
 *  save paths enforce — the test path doesn't care about the key). */
function priceSourceFields(fd: FormData, key: string, builtin: number): db.PriceSource | { error: string } {
  const url = str(fd.get("url"));
  if (!url) return { error: "A request URL is required." };
  const nullable = (name: string) => str(fd.get(name)) || null;
  return {
    key,
    label: str(fd.get("label")) || key,
    kind: fd.get("kind") === "html" ? "html" : "json",
    method: fd.get("method") === "POST" ? "POST" : "GET",
    url,
    body: nullable("body"),
    batch: fd.get("batch") === "on" || fd.get("batch") === "1" ? 1 : 0,
    rows_path: nullable("rows_path"),
    key_field: nullable("key_field"),
    price_field: nullable("price_field"),
    price_path: nullable("price_path"),
    price_regex: nullable("price_regex"),
    history_strategy: str(fd.get("history_strategy")) || "none",
    builtin,
    created_at: null,
  };
}

/** Shared validation + field parsing for add/update. */
function priceSourceFromForm(fd: FormData, builtin: number): db.PriceSource | { error: string } {
  const key = str(fd.get("key")).toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(key)) return { error: "Key must be lowercase letters, numbers, - or _." };
  if (key === db.MANUAL_SOURCE) return { error: `"${db.MANUAL_SOURCE}" is reserved.` };
  return priceSourceFields(fd, key, builtin);
}

export async function addPriceSource(fd: FormData) {
  const parsed = priceSourceFromForm(fd, 0);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  if (db.getPriceSource(parsed.key)) return { ok: false, message: `"${parsed.key}" already exists.` };
  db.savePriceSource(parsed);
  revalidateAll();
  return { ok: true, message: "Price source added." };
}

export async function updatePriceSource(key: string, fd: FormData) {
  const current = db.getPriceSource(key);
  if (!current) return { ok: false, message: "Price source not found." };
  const parsed = priceSourceFromForm(fd, current.builtin);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  if (parsed.key !== key) return { ok: false, message: "The key cannot be changed." };
  db.savePriceSource(parsed);
  revalidateAll();
  return { ok: true, message: "Price source updated." };
}

export async function deletePriceSource(key: string) {
  const current = db.getPriceSource(key);
  if (!current) return { ok: false, message: "Price source not found." };
  if (db.priceSourceInUse(key))
    return { ok: false, message: "A holding still uses this source — reassign it first." };
  db.deletePriceSource(key);
  revalidateAll();
  return { ok: true, message: "Price source deleted." };
}

/** Dry-run the (possibly unsaved) config in the form against a sample symbol. */
export async function testPriceSource(fd: FormData) {
  const parsed = priceSourceFields(fd, str(fd.get("key")) || "test", 0);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  return runPriceSourceTest(parsed, str(fd.get("test_symbol")));
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

export async function logout() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  redirect("/login");
}
