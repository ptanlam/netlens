"use server";

import { revalidatePath } from "next/cache";
import * as db from "@/lib/db";
import {
  refreshAll, refreshHistory, refreshRecentHistory, testPriceSource as runPriceSourceTest,
} from "@/lib/prices";
import { fmtVND } from "@/lib/format";
import { checkListings, listingComp, nearbyListings, type Listing } from "@/lib/listings";
import { estimate, listingId, parseLatLng, type LatLng } from "@/lib/realestate";
import {
  BILLING_CYCLES, COMP_KINDS, GOAL_METRICS, LAND_USES, PRICE_REFRESH_INTERVALS, ROAD_ACCESS,
  SUBSCRIPTION_CATEGORIES, TARGET_CURRENCIES, normalizePriceRefreshMs,
  type BillingCycle, type CompInput, type CompKind, type GoalMetric, type Instrument, type LandUse,
  type RoadAccess, type SubscriptionCategory, type TargetCurrency,
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
  for (const p of ["/", "/investments", "/transactions", "/savings", "/debts", "/subscriptions", "/goals", "/forecast", "/settings/price-sources"])
    revalidatePath(p);
  // "layout", so every plot's page under it (/real-estate/<name>) is refreshed too.
  revalidatePath("/real-estate", "layout");
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

// ---------- real estate (land valuation) ----------

const oneOf = <T extends string>(list: readonly T[], v: string, fallback: T): T =>
  (list as readonly string[]).includes(v) ? (v as T) : fallback;

/** Hosts a shared map link may pass through on its way to the coordinates. Anything else is
 *  refused rather than fetched — this runs on the server, with whatever the form says. */
const MAP_HOSTS = /(^|\.)(goo\.gl|google\.com|google\.com\.vn)$/;

/**
 * Coordinates from what was pasted. A link shared from the Google Maps app is a short
 * `maps.app.goo.gl` one with no coordinates in it until it's followed, so the server follows
 * it — a few redirects at most, and only through Google's own hosts.
 */
async function resolveLocation(input: string): Promise<LatLng | null> {
  const direct = parseLatLng(input);
  if (direct) return direct;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  for (let hop = 0; hop < 4 && MAP_HOSTS.test(url.hostname); hop++) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      const next = res.headers.get("location");
      if (!next) return null;
      const hit = parseLatLng(next);
      if (hit) return hit;
      url = new URL(next, url);
    } catch {
      return null;
    }
  }
  return null;
}

const LOCATION_HELP = "Paste coordinates (10.4012, 107.2345) or a Google Maps link.";

export async function saveProperty(instrument: string, fd: FormData) {
  const inst = await db.getInstrument(instrument);
  if (!inst || inst.asset_type !== "Real Estate")
    return { ok: false, message: "That isn't a Real Estate holding." };
  const at = await resolveLocation(str(fd.get("location")));
  if (!at) return { ok: false, message: LOCATION_HELP };
  const area = num(fd.get("area_m2"));
  if (area == null || area <= 0) return { ok: false, message: "A positive area (m²) is required." };
  const radius = num(fd.get("radius_km")) ?? 3;
  if (radius <= 0 || radius > 50) return { ok: false, message: "Radius must be between 0 and 50 km." };
  await db.saveProperty(
    instrument, at.lat, at.lng, area,
    oneOf<LandUse>(LAND_USES, str(fd.get("land_use")), "residential"),
    oneOf<RoadAccess>(ROAD_ACCESS, str(fd.get("access")), "alley"),
    radius, str(fd.get("note")) || null,
  );
  revalidateAll();
  return { ok: true, message: "Location saved." };
}

export async function deleteProperty(instrument: string) {
  await db.deleteProperty(instrument);
  revalidateAll();
  return { ok: true, message: "Location removed. The holding keeps its value." };
}

async function parseComp(
  fd: FormData,
): Promise<{ ok: true; value: CompInput } | { ok: false; message: string }> {
  const at = await resolveLocation(str(fd.get("location")));
  if (!at) return { ok: false, message: LOCATION_HELP };
  const area = num(fd.get("area_m2"));
  if (area == null || area <= 0) return { ok: false, message: "A positive area (m²) is required." };
  const price = num(fd.get("price"));
  if (price == null || price <= 0) return { ok: false, message: "A positive price is required." };
  return {
    ok: true,
    value: {
      lat: at.lat,
      lng: at.lng,
      area_m2: area,
      price,
      date: str(fd.get("date")) || db.todayIso(),
      kind: oneOf<CompKind>(COMP_KINDS, str(fd.get("kind")), "asking"),
      land_use: oneOf<LandUse>(LAND_USES, str(fd.get("land_use")), "residential"),
      access: oneOf<RoadAccess>(ROAD_ACCESS, str(fd.get("access")), "alley"),
      label: str(fd.get("label")) || null,
      source: str(fd.get("source")) || null,
      note: str(fd.get("note")) || null,
    },
  };
}

export async function addComp(instrument: string, fd: FormData) {
  if (!await db.getProperty(instrument)) return { ok: false, message: "Set the location first." };
  const p = await parseComp(fd);
  if (!p.ok) return { ok: false, message: p.message };
  await db.addComp(instrument, p.value);
  revalidateAll();
  return { ok: true, message: "Comp added." };
}

export async function updateComp(id: number, fd: FormData) {
  if (!await db.getComp(id)) return { ok: false, message: "Not found." };
  const p = await parseComp(fd);
  if (!p.ok) return { ok: false, message: p.message };
  await db.updateComp(id, p.value);
  revalidateAll();
  return { ok: true, message: "Comp updated." };
}

export async function deleteComp(id: number) {
  await db.deleteComp(id);
  revalidateAll();
  return { ok: true, message: "Comp deleted." };
}

/** Nhà Tốt listings around a placed plot, each flagged if it's already one of *this plot's*
 *  comps (matched on its listing URL, which is what an import stores as `source`). */
export async function findListings(
  instrument: string,
): Promise<{ ok: true; listings: (Listing & { added: boolean })[] } | { ok: false; message: string }> {
  const property = await db.getProperty(instrument);
  if (!property) return { ok: false, message: "Set the location first." };
  const [found, comps] = await Promise.all([
    nearbyListings(property, property.radius_km), db.listComps(instrument),
  ]);
  if (!found.ok) return found;
  const have = new Set(comps.map((c) => c.source));
  return { ok: true, listings: found.listings.map((l) => ({ ...l, added: have.has(l.url) })) };
}

/**
 * Save the chosen listings as asking-price comps. Takes ids, not listings: the search is run
 * again here, so what's stored is what Nhà Tốt says rather than whatever the browser sent.
 */
export async function importListings(instrument: string, ids: number[]) {
  const property = await db.getProperty(instrument);
  if (!property) return { ok: false, message: "Set the location first." };
  const [found, comps] = await Promise.all([
    nearbyListings(property, property.radius_km), db.listComps(instrument),
  ]);
  if (!found.ok) return found;
  const want = new Set(ids);
  const have = new Set(comps.map((c) => c.source));
  const picked = found.listings.filter((l) => want.has(l.id) && !have.has(l.url));
  await db.addComps(instrument, picked.map(listingComp));
  revalidateAll();
  const gone = ids.length - picked.length;
  return {
    ok: true,
    message: `Added ${picked.length} comp${picked.length === 1 ? "" : "s"} from Nhà Tốt.` +
      (gone > 0 ? ` ${gone} had already been added or were taken down.` : ""),
  };
}

/** Most listings one refresh re-reads. Each is an upstream request, and a Worker invocation
 *  has a subrequest budget; the stalest go first, so a second press covers the rest. */
const MAX_PRICE_CHECKS = 40;

/**
 * Re-read every Nhà Tốt comp of a plot from the listing itself: a new ask replaces the old,
 * and a listing taken down is marked, not deleted. Comps you entered by hand have no listing
 * to re-read and are left alone. Only price, area and date change — a land use or road you
 * corrected on a comp stays corrected.
 */
export async function refreshCompPrices(instrument: string) {
  const targets = (await db.listComps(instrument))
    .flatMap((c) => {
      const id = listingId(c.source);
      return id == null ? [] : [{ comp: c, id }];
    })
    .sort((a, b) => a.comp.date.localeCompare(b.comp.date))
    .slice(0, MAX_PRICE_CHECKS);
  if (targets.length === 0)
    return { ok: false, message: "No Nhà Tốt comps to refresh. Comps you entered by hand have no listing to re-read." };

  const checks = await checkListings(targets.map((t) => t.id));
  const today = db.todayIso();
  const listed = targets.flatMap((t, i) => {
    const c = checks[i];
    return c.status === "listed" ? [{ id: t.comp.id, price: c.price, area_m2: c.area_m2, date: today, was: t.comp }] : [];
  });
  const gone = targets.filter((_, i) => checks[i].status === "gone");
  const unknown = checks.filter((c) => c.status === "unknown").length;
  if (listed.length === 0 && gone.length === 0)
    return { ok: false, message: "Couldn't reach Nhà Tốt. Try again in a moment." };

  await db.applyCompRefresh(listed, gone.map((t) => ({ id: t.comp.id, date: today })));
  revalidateAll();
  const repriced = listed.filter((l) => l.price !== l.was.price || l.area_m2 !== l.was.area_m2).length;
  const newlyGone = gone.filter((t) => t.comp.delisted_on == null).length;
  const parts = [
    repriced > 0 ? `${repriced} new price${repriced === 1 ? "" : "s"}` : "no price has changed",
    newlyGone > 0 && `${newlyGone} no longer listed`,
    unknown > 0 && `${unknown} couldn't be read`,
  ].filter(Boolean);
  return { ok: true, message: `Checked ${targets.length} listing${targets.length === 1 ? "" : "s"}: ${parts.join(", ")}.` };
}

export async function addIndexPoint(instrument: string, fd: FormData) {
  if (!await db.getProperty(instrument)) return { ok: false, message: "Set the location first." };
  const level = num(fd.get("level"));
  if (level == null || level <= 0) return { ok: false, message: "A positive index level is required." };
  await db.savePropertyIndexPoint(instrument, str(fd.get("date")) || db.todayIso(), level, str(fd.get("source")) || null);
  revalidateAll();
  return { ok: true, message: "Index reading saved." };
}

export async function deleteIndexPoint(instrument: string, date: string) {
  await db.deletePropertyIndexPoint(instrument, date);
  revalidateAll();
  return { ok: true, message: "Index reading deleted." };
}

/**
 * Book the estimate's *low* end as the holding's value. Recomputed here rather than taken
 * from the client, so what's written is what the evidence says right now. The low end,
 * because net worth is a number you plan against — the same reason goals assume 0% return.
 */
export async function applyEstimate(instrument: string) {
  const [inst, property, comps, index, anchors] = await Promise.all([
    db.getInstrument(instrument), db.getProperty(instrument), db.listComps(instrument),
    db.listPropertyIndex(instrument), db.realEstateAnchors(),
  ]);
  if (!inst || !property) return { ok: false, message: "Set the location first." };
  // `holdingValue` prefers units × price whenever both exist, so a manual value written
  // under them would be saved and then silently never read.
  if (inst.quantity != null && inst.last_price != null)
    return { ok: false, message: "This holding is valued by units × price, not a manual value." };
  const v = estimate(property, comps, index, anchors[instrument] ?? null, db.todayIso());
  if (v.method === "none" || v.low <= 0) return { ok: false, message: "Nothing to estimate from yet." };
  await db.recordValuation(inst.name, v.low, "estimate", inst.manual_value);
  revalidateAll();
  return { ok: true, message: `${inst.name} now valued at ${fmtVND(v.low)} from today.` };
}

/** Undo a booking. The holding goes back to the latest value booked before it. */
export async function deleteValuation(instrument: string, date: string) {
  await db.deleteValuation(instrument, date);
  revalidateAll();
  return { ok: true, message: "Booking removed." };
}

/**
 * A Real Estate value typed on Investments is a booking too, dated today — or the history
 * would treat it the old way and move the change onto the purchase day. Other manually-valued
 * holdings keep the one flat figure they always had.
 */
async function recordManualEdit(before: Instrument | undefined, assetType: string, manual: number | null) {
  if (!before || assetType !== "Real Estate" || manual == null || manual === before.manual_value) return;
  await db.recordValuation(before.name, manual, "manual", before.manual_value);
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
  const before = await db.getInstrument(name);
  if (!before) return { ok: false, message: "Holding not found." };
  const assetType = str(fd.get("asset_type")) || "Funds";
  const manual = num(fd.get("manual_value"));
  await db.updateInstrumentFields(
    name,
    assetType,
    str(fd.get("price_source")) || "manual",
    str(fd.get("symbol")) || null,
    num(fd.get("quantity")),
    manual,
  );
  await recordManualEdit(before, assetType, manual);
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
  // Read once up front: a Real Estate row whose value changed is booked, which needs the
  // value it had before this save overwrote it.
  const before = new Map((await db.listInstruments()).map((i) => [i.name, i]));
  for (let i = 0; i < rows; i++) {
    const name = str(fd.get(`inst_${i}`));
    if (!name) continue;
    const assetType = str(fd.get(`type_${i}`)) || "Funds";
    const manual = num(fd.get(`manual_${i}`));
    await db.updateInstrumentFields(
      name,
      assetType,
      str(fd.get(`source_${i}`)) || "manual",
      str(fd.get(`symbol_${i}`)) || null,
      num(fd.get(`qty_${i}`)),
      manual,
    );
    await recordManualEdit(before.get(name), assetType, manual);
  }
  revalidateAll();
  return { ok: true, message: "Holdings saved." };
}

/**
 * Refresh now, on demand — the header button and the pull-to-refresh gesture, and nothing
 * else. The *schedule* is the cron's (see `setPriceRefresh` and `refreshScheduled`); this
 * is the reader saying "don't wait for it".
 *
 * It also pulls the last couple of days of closes/NAVs: a fund publishes its NAV a day
 * late, so a live refresh alone can't move it and the day would otherwise sit unsettled
 * until the 12h backfill. That used to be conditional, because the every-few-seconds
 * auto-tick called this too and would have hit each upstream history feed every minute.
 * There is no auto-tick in the browser any more, so every call is a deliberate one and
 * they all want the full thing.
 */
export async function refreshPrices() {
  const [updated, errors] = await refreshAll();
  errors.push(...(await refreshRecentHistory())[1]);
  revalidateAll();
  return {
    ok: errors.length === 0,
    message: `Updated ${updated} price(s).` + (errors.length ? ` ${errors.length} failed.` : ""),
    // Per-source failure reasons, so the client can log which feed was down — the toast
    // only has room for the count.
    errors,
  };
}

/**
 * Set how often the *server* re-quotes prices, for the whole account.
 *
 * One clock, stored once. The cadence used to be a localStorage value per browser, and the
 * browser that held it did the fetching — so the schedule was whatever tab happened to be
 * open, two devices ran two of them, and the setting could not be changed from the phone
 * for the laptop. Writing it here means the cron in `custom-worker.ts` is the only thing
 * that fetches on a schedule, and every device is merely reading what it wrote.
 *
 * No `revalidateAll()`: nothing server-rendered is derived from the cadence. The pill that
 * sets it reads `/api/price-status`, which is uncached.
 */
export async function setPriceRefresh(ms: number) {
  const value = normalizePriceRefreshMs(ms);
  await db.setPriceRefreshMs(value);
  const label = PRICE_REFRESH_INTERVALS.find((i) => i.ms === value)?.label;
  return {
    ok: true,
    ms: value,
    message: value ? `Prices refresh every ${label}, on every device.` : "Automatic price refresh off.",
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

// No auth actions here any more. Signing in and out is Cloudflare Access's job — the nav's
// "Sign out" is a link to `/cdn-cgi/access/logout`, which the edge answers before a request
// ever reaches this app.
