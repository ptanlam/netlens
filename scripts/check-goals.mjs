// Self-check for lib/goals.ts: `node scripts/check-goals.mjs` (Node 24 strips the types).
// Covers holdings earmarked for a sinking fund (`Instrument.goal_id`).
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// lib/goals.ts imports "./savings" without an extension, as the bundler allows; let Node find it.
registerHooks({
  resolve: (spec, ctx, next) => {
    try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".")) return next(`${spec}.ts`, ctx); throw e; }
  },
});
const { fundValue, project, valueAt, withLivePrices } = await import("../lib/goals.ts");

const world = (over) => ({
  today: "2026-11-05", nowMs: Date.parse("2026-11-05T12:00:00Z"),
  investments: 500_000_000, savings: [], debts: [], paymentsByDebt: {},
  funds: [{ id: 1 }], contributions: { 1: [{ goal_id: 1, date: "2026-10-01", amount: 20_000_000 }] },
  savingsByGoal: {}, holdingsByGoal: { 1: ["VNM"] }, holdingValues: { VNM: 80_000_000 },
  holdingBuys: { VNM: 30_000_000 }, plannedMonthly: 0, actualMonthly: 10_000_000, netWorthMonthly: 0,
  rates: {}, ratesAsOf: null, ratesSource: null, apartments: {}, ...over,
});
const fund = {
  id: 1, name: "Car", metric: "fund", target: 200_000_000, baseline: 0, target_date: null,
  monthly_plan: null, target_ccy: "VND", target_amount: null, down_payment_pct: null, archived: 0,
};

const w = world();
// A fund holds its cash plus its holdings at today's value…
assert.equal(fundValue(w, fund), 100_000_000);
// …held flat: no market growth is assumed a year out.
assert.equal(valueAt(w, fund, 12, 0), 100_000_000);
// A net-worth goal leaves the earmarked holding out, as it does the cash.
assert.equal(valueAt(w, { metric: "net_worth" }, 0, 0), 500_000_000 - 20_000_000 - 80_000_000);
// An investments goal still sees it — the holding never left Investments.
assert.equal(valueAt(w, { metric: "investments" }, 0, 0), 500_000_000);
// The fund's own pace counts what you bought of its holding: (20M cash + 30M buys) / 6 months.
const p = project(fund, w);
assert.equal(p.paceSource, "actual");
assert.equal(Math.round(p.pace), Math.round(50_000_000 / 6));

// A price tick re-prices the holding along with the total; one missing from the tick is worth 0.
const ticked = withLivePrices(w, { portfolioTotal: 520_000_000, portfolio: [{ name: "VNM", value: 100_000_000 }] });
assert.equal(ticked.investments, 520_000_000);
assert.equal(fundValue(ticked, fund), 120_000_000);
assert.equal(fundValue(withLivePrices(w, { portfolioTotal: 0, portfolio: [] }), fund), 20_000_000);

// Nothing earmarked: the fund is its cash alone.
assert.equal(fundValue(world({ holdingsByGoal: {}, holdingValues: {} }), fund), 20_000_000);

// A net-worth goal paces on your history, never on your recurring rules.
const nw = { ...fund, id: 2, name: "1B", metric: "net_worth", target: 1_000_000_000 };
const rulesOnly = project(nw, world({ plannedMonthly: 50_000_000, actualMonthly: 0, netWorthMonthly: 0 }));
assert.equal(rulesOnly.paceSource, "none");
const lived = project(nw, world({ plannedMonthly: 50_000_000, actualMonthly: 5_000_000, netWorthMonthly: 12_000_000 }));
assert.equal(lived.paceSource, "actual");
assert.equal(lived.pace, 12_000_000);
// A monthly plan still wins over both.
assert.equal(project({ ...nw, monthly_plan: 3_000_000 }, world({ netWorthMonthly: 12_000_000 })).pace, 3_000_000);
// An investments goal keeps the higher of rules and buys.
assert.equal(project({ ...nw, metric: "investments" }, world({ plannedMonthly: 50_000_000 })).paceSource, "planned");

console.log("goals: ok");
