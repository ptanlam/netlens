"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import * as db from "@/lib/db";
import {
  refreshAll, refreshHistory, refreshRecentHistory, testPriceSource as runPriceSourceTest,
} from "@/lib/prices";
import { authToken, COOKIE_NAME } from "@/lib/auth";
import { fmtVND } from "@/lib/format";
import {
  BILLING_CYCLES, GOAL_METRICS, SUBSCRIPTION_CATEGORIES, TARGET_CURRENCIES,
  type BillingCycle, type GoalMetric, type SubscriptionCategory, type TargetCurrency,
} from "@/lib/types";

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function revalidateAll() {
  for (const p of ["/", "/investments", "/savings", "/debts", "/subscriptions", "/goals", "/settings/price-sources"])
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
  await db.addTransaction(
    str(fd.get("date")) || db.todayIso(),
    str(fd.get("asset_type")) || "Funds",
    instrument, signed.amount, signed.quantity,
    str(fd.get("note")) || null,
  );
  revalidateAll();
  return { ok: true, message: "Transaction saved." };
}

export async function updateTx(id: number, fd: FormData) {
  if (!await db.getTransaction(id)) return { ok: false, message: "Not found." };
  const instrument = str(fd.get("instrument"));
  const signed = signedTx(fd);
  if (!instrument || !signed)
    return { ok: false, message: "Instrument and a positive amount are required." };
  await db.updateTransaction(
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
  await db.deleteTransaction(id);
  revalidateAll();
  return { ok: true, message: "Transaction deleted." };
}

export async function setTxQty(id: number, quantity: number, addToHoldings: boolean) {
  const ok = await db.setTransactionQuantity(id, quantity, addToHoldings);
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
  await db.addSaving(s.bank, s.principal, s.rate, s.start_date, s.term_months, s.interest_type, s.goal_id, s.note);
  revalidateAll();
  return { ok: true, message: "Deposit saved." };
}

export async function updateSaving(id: number, fd: FormData) {
  if (!await db.getSaving(id)) return { ok: false, message: "Not found." };
  const p = parseSaving(fd);
  if (!p.ok) return { ok: false, message: p.message };
  const s = p.value;
  await db.updateSaving(id, s.bank, s.principal, s.rate, s.start_date, s.term_months, s.interest_type, s.goal_id, s.note);
  revalidateAll();
  return { ok: true, message: "Deposit updated." };
}

export async function deleteSaving(id: number) {
  await db.deleteSaving(id);
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
  await db.addDebt(d.lender, d.principal, d.rate, d.start_date, d.term_months, d.interest_type, d.kind, d.monthly_payment, d.note);
  revalidateAll();
  return { ok: true, message: "Debt saved." };
}

export async function updateDebt(id: number, fd: FormData) {
  if (!await db.getDebt(id)) return { ok: false, message: "Not found." };
  const p = parseDebt(fd);
  if (!p.ok) return { ok: false, message: p.message };
  const d = p.value;
  await db.updateDebt(id, d.lender, d.principal, d.rate, d.start_date, d.term_months, d.interest_type, d.kind, d.monthly_payment, d.note);
  revalidateAll();
  return { ok: true, message: "Debt updated." };
}

/** Close a paid-off debt, or reopen one. Keeps every repayment — unlike deleting it. */
export async function archiveDebt(id: number, archived: boolean) {
  if (!await db.getDebt(id)) return { ok: false, message: "Not found." };
  await db.setDebtArchived(id, archived);
  revalidateAll();
  return { ok: true, message: archived ? "Debt settled." : "Debt reopened." };
}

export async function deleteDebt(id: number) {
  await db.deleteDebt(id);
  revalidateAll();
  return { ok: true, message: "Debt deleted." };
}

export async function addDebtPayment(debtId: number, fd: FormData) {
  if (!await db.getDebt(debtId)) return { ok: false, message: "Debt not found." };
  const amount = num(fd.get("amount"));
  if (amount == null || amount <= 0)
    return { ok: false, message: "A positive payment amount is required." };
  await db.addDebtPayment(debtId, str(fd.get("date")) || db.todayIso(), amount, str(fd.get("note")) || null);
  revalidateAll();
  return { ok: true, message: "Payment recorded." };
}

export async function updateDebtPayment(id: number, fd: FormData) {
  const amount = num(fd.get("amount"));
  if (amount == null || amount <= 0)
    return { ok: false, message: "A positive payment amount is required." };
  const ok = await db.updateDebtPayment(id, str(fd.get("date")) || db.todayIso(), amount, str(fd.get("note")) || null);
  revalidateAll();
  return { ok, message: ok ? "Payment updated." : "Payment not found." };
}

export async function deleteDebtPayment(id: number) {
  await db.deleteDebtPayment(id);
  revalidateAll();
  return { ok: true, message: "Payment deleted." };
}

// ---------- subscriptions (recurring charges) ----------

type ParsedSubscription = {
  name: string;
  amount: number;
  cycle: BillingCycle;
  start_date: string;
  category: SubscriptionCategory;
  payment_method: string | null;
  note: string | null;
};

function parseSubscription(
  fd: FormData,
): { ok: true; value: ParsedSubscription } | { ok: false; message: string } {
  const name = str(fd.get("name"));
  const amount = num(fd.get("amount"));
  const cycleRaw = str(fd.get("cycle")) as BillingCycle;
  const categoryRaw = str(fd.get("category")) as SubscriptionCategory;
  if (!name) return { ok: false, message: "A subscription name is required." };
  if (amount == null || amount <= 0)
    return { ok: false, message: "A positive amount is required." };
  return {
    ok: true,
    value: {
      name,
      amount,
      // The amount means nothing without its period, so an unrecognised cycle can't be
      // waved through the way a missing note can — but the select only ever posts one of
      // the four, so this is a guard, not a branch the UI can reach.
      cycle: BILLING_CYCLES.includes(cycleRaw) ? cycleRaw : "monthly",
      start_date: str(fd.get("start_date")) || db.todayIso(),
      category: SUBSCRIPTION_CATEGORIES.includes(categoryRaw) ? categoryRaw : "Other",
      payment_method: str(fd.get("payment_method")) || null,
      note: str(fd.get("note")) || null,
    },
  };
}

export async function addSubscription(fd: FormData) {
  const p = parseSubscription(fd);
  if (!p.ok) return { ok: false, message: p.message };
  const s = p.value;
  await db.addSubscription(s.name, s.amount, s.cycle, s.start_date, s.category, s.payment_method, s.note);
  revalidateAll();
  return { ok: true, message: "Subscription saved." };
}

export async function updateSubscription(id: number, fd: FormData) {
  if (!await db.getSubscription(id)) return { ok: false, message: "Not found." };
  const p = parseSubscription(fd);
  if (!p.ok) return { ok: false, message: p.message };
  const s = p.value;
  await db.updateSubscription(id, s.name, s.amount, s.cycle, s.start_date, s.category, s.payment_method, s.note);
  revalidateAll();
  return { ok: true, message: "Subscription updated." };
}

/** Stop a plan billing, or put it back on its schedule. Keeps what it has cost you —
 *  unlike deleting it, which is for a row you added by mistake. */
export async function cancelSubscription(id: number, cancelled: boolean) {
  if (!await db.getSubscription(id)) return { ok: false, message: "Not found." };
  await db.setSubscriptionCancelled(id, cancelled);
  revalidateAll();
  return { ok: true, message: cancelled ? "Subscription cancelled." : "Subscription resumed." };
}

export async function deleteSubscription(id: number) {
  await db.deleteSubscription(id);
  revalidateAll();
  return { ok: true, message: "Subscription deleted." };
}

// ---------- goals ----------

type ParsedGoal = {
  name: string;
  metric: GoalMetric;
  target: number;
  target_ccy: TargetCurrency;
  target_amount: number | null;
  baseline: number;
  monthly_plan: number | null;
  target_date: string | null;
  note: string | null;
};

/**
 * `rates` is VND per unit of each foreign currency (`db.fxRates().rate`). It's a parameter
 * rather than a read in here because parsing a form is sync and because the caller already
 * has to touch the DB — but it does mean a dollar goal cannot be saved before the first
 * rate has landed, which is exactly what the error below says.
 */
function parseGoal(
  fd: FormData,
  rates: Record<string, number>,
): { ok: true; value: ParsedGoal } | { ok: false; message: string } {
  const name = str(fd.get("name"));
  const metricRaw = str(fd.get("metric")) as GoalMetric;
  const metric = GOAL_METRICS.includes(metricRaw) ? metricRaw : "net_worth";
  const ccyRaw = str(fd.get("target_ccy")) as TargetCurrency;
  const ccy: TargetCurrency = TARGET_CURRENCIES.includes(ccyRaw) ? ccyRaw : "VND";
  // The one amount field means whatever the currency picker says it means: dong for a VND
  // goal, whole dollars for a USD one.
  const amount = num(fd.get("target"));
  const rate = ccy === "VND" ? 1 : rates[ccy];
  if (ccy !== "VND" && !rate)
    return {
      ok: false,
      message: `No ${ccy} exchange rate yet — refresh prices, then save this goal.`,
    };
  const target = amount == null ? null : Math.round(amount * rate);
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
      target_ccy: ccy,
      // Only a foreign goal keeps an amount — for a VND one the target IS the amount, and
      // storing it twice would leave two numbers that could disagree.
      target_amount: ccy === "VND" ? null : amount,
      baseline,
      monthly_plan: plan != null && plan > 0 ? plan : null,
      target_date: str(fd.get("target_date")) || null,
      note: str(fd.get("note")) || null,
    },
  };
}

export async function addGoal(fd: FormData) {
  const p = parseGoal(fd, (await db.fxRates()).rate);
  if (!p.ok) return { ok: false, message: p.message };
  const g = p.value;
  await db.addGoal(g.name, g.metric, g.target, g.baseline, g.monthly_plan, g.target_date, g.note,
    g.target_ccy, g.target_amount);
  revalidateAll();
  return { ok: true, message: "Goal saved." };
}

export async function updateGoal(id: number, fd: FormData) {
  const [existing, fx] = await Promise.all([db.getGoal(id), db.fxRates()]);
  if (!existing) return { ok: false, message: "Not found." };
  const p = parseGoal(fd, fx.rate);
  if (!p.ok) return { ok: false, message: p.message };
  const g = p.value;
  // Switching a fund to another metric would strand its ledger — the money would vanish
  // from net worth while its rows sat in the table. Renaming and re-targeting are fine.
  if (existing.metric === "fund" && g.metric !== "fund" && (await db.listGoalContributions(id)).length > 0)
    return {
      ok: false,
      message: "This fund holds money. Withdraw it (or mark it as bought) before changing what it tracks.",
    };
  await db.updateGoal(id, g.name, g.metric, g.target, g.baseline, g.monthly_plan, g.target_date, g.note,
    g.target_ccy, g.target_amount);
  revalidateAll();
  return { ok: true, message: "Goal updated." };
}

/** Put money into a sinking fund (or take it out — a negative amount is a withdrawal). */
export async function addGoalContribution(goalId: number, fd: FormData) {
  const goal = await db.getGoal(goalId);
  if (!goal) return { ok: false, message: "Goal not found." };
  if (goal.metric !== "fund")
    return { ok: false, message: "Only a sinking fund holds money." };
  const amount = num(fd.get("amount"));
  if (amount == null || amount === 0)
    return { ok: false, message: "An amount is required." };
  const withdraw = str(fd.get("direction")) === "withdraw";
  const signed = withdraw ? -Math.abs(amount) : Math.abs(amount);
  await db.addGoalContribution(goalId, str(fd.get("date")) || db.todayIso(), signed, str(fd.get("note")) || null);
  revalidateAll();
  return { ok: true, message: withdraw ? "Withdrawal recorded." : "Money added." };
}

export async function deleteGoalContribution(id: number) {
  await db.deleteGoalContribution(id);
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
  const goal = await db.getGoal(goalId);
  if (!goal) return { ok: false, message: "Goal not found." };
  if (goal.metric !== "fund") return { ok: false, message: "Only a sinking fund holds money." };

  const cash = await db.fundCash(goalId);
  const deposits = (await db.savingsByGoal())[goalId] ?? [];
  if (cash <= 0 && deposits.length === 0) return { ok: false, message: "This fund is empty." };

  if (cash > 0) await db.addGoalContribution(goalId, db.todayIso(), -Math.round(cash), `Bought: ${goal.name}`);
  await db.unlinkGoalSavings(goalId);
  await db.setGoalArchived(goalId, true);
  revalidateAll();

  const parts = [cash > 0 ? `${fmtVND(cash)} in cash spent` : null,
    deposits.length > 0
      ? `${deposits.length} deposit${deposits.length === 1 ? "" : "s"} released — delete ${deposits.length === 1 ? "it" : "them"} on Savings once withdrawn`
      : null].filter(Boolean);
  return { ok: true, message: `${parts.join(" · ")} — goal archived.` };
}

/** Move a goal one place up or down your ranking. */
export async function moveGoal(id: number, direction: "up" | "down") {
  const moved = await db.moveGoal(id, direction);
  if (!moved) return { ok: false, message: "Already at the end." };
  revalidateAll();
  return { ok: true, message: "" };
}

export async function archiveGoal(id: number, archived: boolean) {
  if (!await db.getGoal(id)) return { ok: false, message: "Not found." };
  await db.setGoalArchived(id, archived);
  revalidateAll();
  return { ok: true, message: archived ? "Goal archived." : "Goal restored." };
}

export async function deleteGoal(id: number) {
  await db.deleteGoal(id);
  revalidateAll();
  return { ok: true, message: "Goal deleted." };
}

// ---------- holdings ----------

export async function addHolding(fd: FormData) {
  const name = str(fd.get("name"));
  if (!name) return { ok: false, message: "A holding name is required." };
  if (await db.getInstrument(name)) return { ok: false, message: `"${name}" already exists.` };
  await db.addInstrument(
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
  if (!await db.getInstrument(name)) return { ok: false, message: "Holding not found." };
  await db.updateInstrumentFields(
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

export async function setHoldingArchived(name: string, archived: boolean) {
  if (!await db.getInstrument(name)) return { ok: false, message: "Holding not found." };
  await db.setInstrumentArchived(name, archived);
  revalidateAll();
  return { ok: true, message: archived ? "Holding archived." : "Holding restored." };
}

export async function deleteHolding(name: string) {
  if (await db.instrumentInUse(name))
    return { ok: false, message: "Remove its transactions and recurring rules first." };
  await db.deleteInstrument(name);
  revalidateAll();
  return { ok: true, message: "Holding deleted." };
}

export async function saveHoldings(fd: FormData) {
  const rows = Number(fd.get("rows") ?? 0);
  for (let i = 0; i < rows; i++) {
    const name = str(fd.get(`inst_${i}`));
    if (!name) continue;
    await db.updateInstrumentFields(
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

/** `withHistory` also pulls the last couple of days of closes/NAVs — a fund publishes its
 *  NAV a day late, so a live refresh alone can't move it and the day would otherwise sit
 *  unsettled until the 12h backfill. Only a deliberate refresh asks for it; the every-tick
 *  auto-refresh doesn't, since that would hit each upstream history feed every minute. */
export async function refreshPrices(withHistory = false) {
  const [updated, errors] = await refreshAll();
  if (withHistory) errors.push(...(await refreshRecentHistory())[1]);
  revalidateAll();
  return {
    ok: errors.length === 0,
    message: `Updated ${updated} price(s).` + (errors.length ? ` ${errors.length} failed.` : ""),
    // Per-source failure reasons, so the client can log them (a silent auto-refresh shows
    // no toast but still writes an error log).
    errors,
  };
}

/**
 * Refetch the full daily history behind the P&L chart, now, ignoring the 12h throttle
 * (`maxAgeHours = 0` — the age of `history_fetched_at` can never be below zero, so the
 * early return can't fire).
 *
 * The chart is reconstructed on every request from `price_history`, so there is nothing
 * stored to "rebuild" but those closes — refetch them and the whole series moves. Worth
 * having a button for when a feed backfilled a day it had previously skipped, or served a
 * bad close that has since been corrected: waiting up to 12h for the cron to notice is the
 * whole complaint.
 *
 * Upserts, like every other history fetch — it corrects and extends what is stored and
 * never drops it. A row for an instrument no longer served upstream therefore survives,
 * which is why this is a refetch rather than a wipe-and-reload: a partial upstream failure
 * must not be able to leave the chart with less history than it started with.
 *
 * Slow by nature (every instrument's full range, from four upstreams), so the caller is
 * expected to show it as pending rather than fire it silently.
 */
export async function rebuildPnlHistory() {
  const [updated, errors] = await refreshHistory(0);
  revalidateAll();
  return {
    ok: errors.length === 0,
    message:
      `Rebuilt history for ${updated} holding${updated === 1 ? "" : "s"}.` +
      (errors.length ? ` ${errors.length} failed.` : ""),
    errors,
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
  if (await db.getPriceSource(parsed.key)) return { ok: false, message: `"${parsed.key}" already exists.` };
  await db.savePriceSource(parsed);
  revalidateAll();
  return { ok: true, message: "Price source added." };
}

export async function updatePriceSource(key: string, fd: FormData) {
  const current = await db.getPriceSource(key);
  if (!current) return { ok: false, message: "Price source not found." };
  const parsed = priceSourceFromForm(fd, current.builtin);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  if (parsed.key !== key) return { ok: false, message: "The key cannot be changed." };
  await db.savePriceSource(parsed);
  revalidateAll();
  return { ok: true, message: "Price source updated." };
}

export async function deletePriceSource(key: string) {
  const current = await db.getPriceSource(key);
  if (!current) return { ok: false, message: "Price source not found." };
  if (await db.priceSourceInUse(key))
    return { ok: false, message: "A holding still uses this source — reassign it first." };
  await db.deletePriceSource(key);
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
  await db.addRecurring(instrument, str(fd.get("asset_type")) || "Funds", amount, freq,
    str(fd.get("start_date")) || db.todayIso(), str(fd.get("note")) || null);
  const created = await db.materializeRecurring();
  revalidateAll();
  return { ok: true, message: created ? `Rule added — ${created} transaction(s) created.` : "Rule added." };
}

export async function updateRule(id: number, fd: FormData) {
  const instrument = str(fd.get("instrument"));
  const amount = num(fd.get("amount"));
  if (!instrument || amount == null || amount <= 0)
    return { ok: false, message: "Instrument and a positive amount are required." };
  const freq = fd.get("freq") === "monthly" ? "monthly" : "weekly";
  await db.updateRecurring(id, instrument, str(fd.get("asset_type")) || "Funds", amount, freq,
    str(fd.get("start_date")) || db.todayIso(), str(fd.get("note")) || null);
  revalidateAll();
  return { ok: true, message: "Rule updated." };
}

export async function toggleRule(id: number) {
  await db.toggleRecurring(id);
  revalidateAll();
  return { ok: true, message: "Rule updated." };
}

export async function deleteRule(id: number) {
  await db.deleteRecurring(id);
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
